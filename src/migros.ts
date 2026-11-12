import { MigrosAPI } from "migros-api-wrapper";
import { getOnlineCards, mergeSearchResults, searchOnline, type SearchResult } from "./online.js";
import { fetchCategories } from "./categories.js";
import {
  checkRecipeId,
  fetchMigustoRecipe,
  fetchRecipe,
  searchRecipesRequest,
  type MigustoRecipe,
  type RecipeLanguage,
  type RecipeSearchArgs,
  type RecipeSummary,
} from "./recipes.js";

const migros = new MigrosAPI();

/** The guest token, or the request for one that is under way (shared by parallel calls). */
let cachedToken: Promise<string> | null = null;

function getToken(): Promise<string> {
  cachedToken ??= migros.account.oauth2.loginGuestToken().then(
    (result) => result.token as string,
    (e: unknown) => {
      cachedToken = null;
      throw e;
    }
  );
  return cachedToken;
}

/**
 * True when a failure clearly isn't about the token: a timeout, no
 * connection, or an HTTP answer other than 401/403. A new token wouldn't
 * help, and asking again would only double the traffic while Migros has a
 * problem. Anything else (the wrapper doesn't always say) may be an expired
 * token.
 */
export function notAboutTheToken(e: unknown): boolean {
  const err = e as { code?: unknown; name?: unknown; response?: { status?: unknown } } | null;
  const status = err?.response?.status;
  if (typeof status === "number") return status !== 401 && status !== 403;
  if (
    typeof err?.code === "string" &&
    /^(ECONNABORTED|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)$/.test(err.code)
  )
    return true;
  return err?.name === "TimeoutError" || err?.name === "AbortError";
}

/** Runs `fn` with the guest token; once more with a new token if the first may have expired. */
async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const used = getToken();
  try {
    return await fn(await used);
  } catch (e) {
    if (notAboutTheToken(e)) throw e;
    // Another call may have replaced it already; only drop the one that failed.
    if (cachedToken === used) cachedToken = null;
    return await fn(await getToken());
  }
}

/**
 * Search the in-store catalogue (as before) and the online shop at the same
 * time. Online-only products, such as "Partner" products, come after the
 * in-store results (issue #8). If the online search fails, the in-store
 * result is returned unchanged.
 */
export async function searchProducts(query: string, language: string): Promise<SearchResult> {
  return withToken(async (token) => {
    const [result, onlineIds] = await Promise.all([
      migros.products.productSearch.searchProduct(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the wrapper types language as a narrow union
        { query, language: language as any },
        {},
        token
      ),
      searchOnline(query, language, token).catch(() => [] as string[]),
    ]);
    return mergeSearchResults(
      {
        productIds: result.productIds ?? [],
        numberOfProducts: result.numberOfProducts ?? 0,
      },
      onlineIds
    );
  });
}

/** Ids that are migrosIds (12+ digits) rather than uids. */
export function isMigrosIdList(productIds: string[]): boolean {
  return productIds.every((id) => id.length >= 12 && /^\d+$/.test(id));
}

/**
 * Product cards from the online shop, for uids the in-store details don't
 * know (online-only products). Returns [] if the call fails. No retry with a
 * new token: the details call just before has already checked the token.
 */
export async function getOnlineProductCards(uids: string[]): Promise<unknown[]> {
  if (uids.length === 0) return [];
  try {
    return await getOnlineCards(uids, await getToken());
  } catch {
    return [];
  }
}

export async function getProductDetails(productIds: string[]): Promise<unknown[]> {
  return withToken(async (token) => {
    // Detect if IDs are migrosIds (long numeric, 12+ digits) or uids (shorter numeric)
    const isMigrosId = isMigrosIdList(productIds);
    const params = isMigrosId ? { migrosIds: productIds.join(",") } : { uids: productIds };
    const result = await migros.products.productDisplay.getProductDetails(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the wrapper's params type has no `uids`
      params as any,
      token
    );
    return result ?? [];
  });
}

export async function getStock(
  productId: string,
  storeId: string
): Promise<{ catalogItemId: string; stock: number | null }> {
  return withToken(async (token) => {
    const result = await migros.products.productStock.getProductSupply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the wrapper's params type is incomplete
      { pids: productId, costCenterIds: storeId } as any,
      token
    );
    const avail = (result?.availabilities as Array<{ id: string; stock: number }>) ?? [];
    const match = avail.find((a) => a.id === storeId);
    return {
      catalogItemId: result?.catalogItemId ?? productId,
      stock: match?.stock ?? null,
    };
  });
}

/** The wrapper's categoryList() calls an address Migros removed, so this has its own request. */
export async function getCategories(): Promise<unknown[]> {
  return withToken((token) => fetchCategories(token, "de"));
}

export async function searchStores(query: string): Promise<unknown[]> {
  return withToken(async (token) => {
    const result = await migros.stores.searchStores({ query }, token);
    return result ?? [];
  });
}

export async function getPromotions(query: string): Promise<unknown> {
  return withToken(async (token) => {
    const result = await migros.products.productDisplay.getProductPromotionSearch({ query }, token);
    return result?.items ?? [];
  });
}

// ---------------------------------------------------------------------------
// Recipes: Migusto pages (search, details by slug) and the migros.ch recipe
// API (one recipe by id). The wrapper's Migusto calls hit an API Migusto
// removed, see recipes.ts.
// ---------------------------------------------------------------------------

/** No token: Migusto's recipe list is a public web page. */
export async function searchRecipes(
  args: RecipeSearchArgs,
  language: RecipeLanguage
): Promise<{ total?: number; recipes: RecipeSummary[] }> {
  return searchRecipesRequest(args, language);
}

export async function getRecipe(id: string, language: RecipeLanguage): Promise<Record<string, unknown>> {
  const recipeId = checkRecipeId(id); // before any request, so a bad id costs nothing
  return withToken((token) => fetchRecipe(recipeId, language, token));
}

/** No token: the Migusto recipe page is a public web page. */
export async function getRecipeDetails(slug: string, language: RecipeLanguage): Promise<MigustoRecipe> {
  return fetchMigustoRecipe(slug, language);
}
