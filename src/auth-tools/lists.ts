import { api } from "../auth/api.js";
import { credsFromEnv } from "./_shared.js";

/**
 * Creating, renaming and deleting shopping lists, and notes on list items.
 * The routes are the ones the migros.ch website calls (its shopping-list
 * client), checked on a test account in November 2026.
 */

const SL = "/shopping-list/public";

/** An authenticated request; tests pass a fake. */
export type Request = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<unknown>;

const migros: Request = (method, path, body) => api(method, path, body, { creds: credsFromEnv() });

interface ListSummary {
  shoppingListId: number;
  shoppingListName?: string;
  itemsCount?: number;
  isOwner?: boolean;
}

interface ListItem {
  id: string;
  type: string;
  quantity: number;
  note?: string;
}

async function lists(request: Request): Promise<ListSummary[]> {
  return ((await request("GET", `${SL}/v1/lists/overview`)) as ListSummary[] | null) ?? [];
}

async function findList(request: Request, shoppingListId: number): Promise<ListSummary> {
  const list = (await lists(request)).find((l) => l.shoppingListId === shoppingListId);
  if (!list) throw new Error(`no shopping list ${shoppingListId}: use get_shopping_lists for the ids`);
  return list;
}

export async function createShoppingList(args: { name: string }, request: Request = migros): Promise<string> {
  const created = (await request("POST", `${SL}/v1/list`, { name: args.name })) as { shoppingListId?: number } | null;
  if (typeof created?.shoppingListId !== "number") throw new Error("Migros did not return the new list's id");
  return JSON.stringify(
    {
      created: true,
      shoppingListId: created.shoppingListId,
      name: args.name,
      hint: "Pass this shoppingListId to add_to_basket and the other basket tools to fill this list.",
    },
    null,
    2
  );
}

export async function renameShoppingList(
  args: { shoppingListId: number; name: string },
  request: Request = migros
): Promise<string> {
  const before = await findList(request, args.shoppingListId);
  await request("PUT", `${SL}/v1/list/rename`, { shoppingListId: args.shoppingListId, shoppingListName: args.name });
  return JSON.stringify(
    { renamed: true, shoppingListId: args.shoppingListId, from: before.shoppingListName, to: args.name },
    null,
    2
  );
}

export async function deleteShoppingList(
  args: { shoppingListId: number; confirm?: boolean },
  request: Request = migros
): Promise<string> {
  const list = await findList(request, args.shoppingListId);
  if (args.confirm !== true) {
    return JSON.stringify(
      {
        deleted: false,
        message:
          `Not deleted. This removes the list "${list.shoppingListName ?? args.shoppingListId}" with its ` +
          `${list.itemsCount ?? "unknown number of"} items, and it can't be undone. Ask the user, then call ` +
          "delete_shopping_list again with confirm: true.",
      },
      null,
      2
    );
  }
  if ((await lists(request)).length <= 1) {
    throw new Error("this is the only shopping list; it is not deleted, so the basket tools keep a list to work with");
  }
  await request("DELETE", `${SL}/v1/list/delete/${args.shoppingListId}`);
  return JSON.stringify({ deleted: true, shoppingListId: args.shoppingListId, name: list.shoppingListName }, null, 2);
}

/**
 * Set the note of an item that is already in a list ("laktosefrei", "the big
 * pack"). Keeps its quantity: Migros' item update sets both at once.
 */
export async function setItemNote(
  args: { productId: string; note: string; shoppingListId?: number },
  request: Request = migros
): Promise<string> {
  const listId = args.shoppingListId ?? (await lists(request))[0]?.shoppingListId;
  if (typeof listId !== "number") throw new Error("no shopping lists found for this account");
  const details = (await request("GET", `${SL}/v2/list/details?shoppingListId=${listId}`)) as {
    categories?: Array<{ items?: ListItem[] }>;
  } | null;
  const item = (details?.categories ?? []).flatMap((c) => c.items ?? []).find((i) => String(i.id) === args.productId);
  if (!item) throw new Error(`product ${args.productId} is not in this list: add it with add_to_basket first`);
  await request("PUT", `${SL}/v3/items`, {
    shoppingListId: listId,
    items: [{ id: item.id, quantity: item.quantity, type: item.type, note: args.note }],
  });
  return JSON.stringify(
    { noted: true, shoppingListId: listId, productId: args.productId, quantity: item.quantity, note: args.note },
    null,
    2
  );
}
