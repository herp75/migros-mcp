import { z } from "zod";

// ---------------------------------------------------------------------------
// Limits. The AI fills these in, and can be steered by text it read: an id goes
// into a Migros URL only if it is a plain id, and nothing is unbounded.
// ---------------------------------------------------------------------------

/** Product, store, order and receipt ids: digits and letters, as Migros uses them. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_QUERY = 200;
const MAX_IDS = 50;
/** More of one product than a household buys at once; catches a slip like 10000. */
export const MAX_QUANTITY = 999;

const id = (what: string) =>
  z.string().regex(ID_PATTERN, `${what} must be a plain id from Migros (letters, digits, - or _)`);
const query = () => z.string().max(MAX_QUERY);
const language = () => z.string().max(5);
const listId = () => z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------
// Anonymous: products, stores, promotions
// ---------------------------------------------------------------------------

export const SearchProductsSchema = z.object({
  query: query().describe("Search query for Migros products"),
  language: language().optional().default("de").describe("Language for results (de, fr, it, en). Default: de"),
});

export const GetProductDetailsSchema = z.object({
  productIds: z
    .array(id("productIds"))
    .min(1)
    .max(MAX_IDS)
    .describe("Array of product IDs (UIDs) to get details for. Get these from search_products first."),
});

export const SearchStoresSchema = z.object({
  query: query().describe("Search query for Migros stores (city name, zip code, etc.)"),
});

export const GetStockSchema = z.object({
  productId: id("productId").describe("Product UID to check stock for. Get this from search_products."),
  storeId: id("storeId").describe("Store ID (costCenterId) to check stock at. Get this from search_stores."),
});

export const GetPromotionsSchema = z.object({
  query: query().optional().default("").describe("Optional search query to filter promotions"),
});

// ---------------------------------------------------------------------------
// Anonymous: recipes (Migusto)
// ---------------------------------------------------------------------------

export const SearchRecipesSchema = z.object({
  query: query().optional().describe("Free-text search term, e.g. 'pasta carbonara'."),
  ingredients: z
    .array(z.string().max(100))
    .max(20)
    .optional()
    .describe("Filter to recipes that use these ingredients."),
  language: language().optional().describe("Language code: de, fr, it. Default: de."),
  limit: z.number().int().min(1).max(50).optional().describe("Max recipes to return. Default: 20."),
  offset: z.number().int().min(0).max(10_000).optional().describe("0-based offset for pagination."),
});

export const GetRecipeDetailsSchema = z.object({
  slug: z
    .string()
    .max(300)
    .describe("Recipe slug from search_recipes (the URL-safe name, e.g. 'marroni-aus-dem-ofen')."),
  language: language().optional().describe("Language code: de, fr, it. Default: de."),
});

export const GetRecipeProductsSchema = z.object({
  recipeId: z.string().max(20).describe("Numeric recipe id from search_recipes (e.g. '39632'). NOT the slug."),
  language: language().optional().describe("Language code: de, fr, it. Default: de."),
  limit: z.number().int().min(1).max(100).optional().describe("Max products to return. Default: 50."),
  offset: z.number().int().min(0).max(10_000).optional().describe("0-based offset for pagination."),
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const AuthenticateSchema = z.object({
  totpCode: z
    .string()
    .regex(/^\d{6}$/, "totpCode must be exactly six digits")
    .optional()
    .describe("Current six-digit TOTP code. Omit to reuse a cached session, or if the account has no 2FA."),
});

// ---------------------------------------------------------------------------
// Authenticated: cart
// ---------------------------------------------------------------------------

export const GetBasketSchema = z.object({
  shoppingListId: listId()
    .optional()
    .describe("Optional shopping list ID from get_shopping_lists. Omit to use the first list."),
});

export const GetCheckoutLinkSchema = z.object({
  shoppingListId: listId()
    .optional()
    .describe("Optional shopping list ID from get_shopping_lists. Omit to use the first list."),
});

export const AddToBasketSchema = z.object({
  productId: id("productId").describe("Product UID from search_products (e.g. '100049709')."),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(MAX_QUANTITY)
    .optional()
    .describe("Target quantity. Defaults to 1. REPLACES existing quantity, not increment."),
  shoppingListId: listId().optional().describe("Optional list ID from get_shopping_lists; omit to use the first list."),
});

export const UpdateBasketQuantitySchema = z.object({
  productId: id("productId").describe("Product UID."),
  quantity: z.number().int().min(0).max(MAX_QUANTITY).describe("Exact target quantity. 0 removes the item."),
  shoppingListId: listId().optional(),
});

export const RemoveFromBasketSchema = z.object({
  productId: id("productId").describe("Product UID to remove from the basket."),
  shoppingListId: listId().optional(),
});

// ---------------------------------------------------------------------------
// Authenticated: orders
// ---------------------------------------------------------------------------

export const GetOrdersSchema = z.object({
  status: z
    .enum(["PENDING", "DELIVERED", "CANCELLED", "ALL"])
    .optional()
    .describe("Filter by order status. Default: ALL."),
  page: z.number().int().min(0).max(1_000).optional().describe("0-based page number. Default: 0."),
});

export const GetOrderDetailsSchema = z.object({
  orderId: z
    .union([id("orderId"), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .describe("Order id (numeric). Get from get_orders."),
});

// ---------------------------------------------------------------------------
// Authenticated: Cumulus / in-store
// ---------------------------------------------------------------------------

export const GetInStoreReceiptsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Start date YYYY-MM-DD. Default: 30 days ago."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("End date YYYY-MM-DD. Default: today."),
  limit: z.number().int().min(1).max(500).optional().describe("Max receipts to return. Default: 50."),
});

export const GetReceiptDetailsSchema = z.object({
  receiptId: z
    .union([id("receiptId"), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .describe("Receipt id from get_in_store_receipts."),
});

// ---------------------------------------------------------------------------
// Authenticated: shopping lists
// ---------------------------------------------------------------------------

const listName = () => z.string().trim().min(1).max(100);

export const CreateShoppingListSchema = z.object({
  name: listName().describe("Name of the new list, e.g. 'Wochenende'."),
});

export const RenameShoppingListSchema = z.object({
  shoppingListId: listId().describe("List ID from get_shopping_lists."),
  name: listName().describe("The new name."),
});

export const DeleteShoppingListSchema = z.object({
  shoppingListId: listId().describe("List ID from get_shopping_lists."),
  confirm: z
    .boolean()
    .optional()
    .describe("Must be true to delete. Ask the user first: the list and its items are gone for good."),
});

export const SetItemNoteSchema = z.object({
  productId: id("productId").describe("Product UID of an item already in the list."),
  note: z.string().trim().min(1).max(200).describe("The note, e.g. 'laktosefrei' or 'die grosse Packung'."),
  shoppingListId: listId().optional().describe("Optional list ID from get_shopping_lists; omit to use the first list."),
});

// ---------------------------------------------------------------------------
// Authenticated: Cumulus coupons
// ---------------------------------------------------------------------------

export const CouponSchema = z.object({
  ean: z
    .string()
    .regex(/^\d{8,20}$/, "ean must be the coupon's number from get_cumulus_coupons")
    .describe("The coupon's ean from get_cumulus_coupons."),
});
