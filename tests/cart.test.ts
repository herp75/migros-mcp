/**
 * The basket tools: which list they use, the quantity they send (Migros
 * replaces it, never adds), and what get_checkout_link says. No network: each
 * tool gets a fake request that records the calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addToBasket,
  getBasket,
  getCheckoutLink,
  getShoppingLists,
  removeFromBasket,
  updateBasketQuantity,
} from "../src/auth-tools/cart.js";

type Call = { method: string; path: string; body?: unknown };

const OVERVIEW = [
  { shoppingListId: 11, shoppingListName: "Einkauf" },
  { shoppingListId: 22, shoppingListName: "Party" },
];
const BASKET = {
  shoppingListId: 11,
  name: "Einkauf",
  totals: { instoreTotal: 9.5, onlineTotal: { estimatedTotal: 10.2, minimumOrderValueReached: true } },
  categories: [{ id: 1, items: [{ id: "100100", type: "PRODUCT", quantity: 3 }] }],
};

function fake(basket: unknown = BASKET) {
  const calls: Call[] = [];
  const request = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (path === "/shopping-list/public/v1/lists/overview") return OVERVIEW;
    return basket;
  };
  return { calls, request: request as never };
}

const ITEMS = "/shopping-list/public/v3/items";

describe("basket", () => {
  it("uses the first list when none is given", async () => {
    const f = fake();
    const out = JSON.parse(await getBasket({}, f.request));
    assert.equal(f.calls[0].path, "/shopping-list/public/v1/lists/overview");
    assert.equal(f.calls[1].path, "/shopping-list/public/v2/list/details?shoppingListId=11");
    assert.equal(out.itemCount, 1);
    assert.equal(out.items[0].quantity, 3);
  });

  it("uses the given list without asking for the overview", async () => {
    const f = fake();
    await getBasket({ shoppingListId: 22 }, f.request);
    assert.deepEqual(
      f.calls.map((c) => c.path),
      ["/shopping-list/public/v2/list/details?shoppingListId=22"]
    );
  });

  it("add_to_basket sends the target quantity (1 by default), not an increment", async () => {
    const f = fake();
    await addToBasket({ productId: "100100" }, f.request);
    await addToBasket({ productId: "100100", quantity: 2, shoppingListId: 22 }, f.request);
    const puts = f.calls.filter((c) => c.path === ITEMS);
    assert.deepEqual(puts[0].body, { shoppingListId: 11, items: [{ id: "100100", quantity: 1, type: "PRODUCT" }] });
    assert.deepEqual(puts[1].body, { shoppingListId: 22, items: [{ id: "100100", quantity: 2, type: "PRODUCT" }] });
    assert.ok(puts.every((c) => c.method === "PUT"));
  });

  it("add_to_basket refuses a quantity below 1", async () => {
    const f = fake();
    await assert.rejects(addToBasket({ productId: "100100", quantity: 0 }, f.request), /use remove_from_basket/);
    assert.equal(f.calls.length, 0);
  });

  it("update and remove send the exact quantity", async () => {
    const f = fake();
    await updateBasketQuantity({ productId: "100100", quantity: 5, shoppingListId: 11 }, f.request);
    await removeFromBasket({ productId: "100100", shoppingListId: 11 }, f.request);
    await assert.rejects(updateBasketQuantity({ productId: "100100", quantity: -1 }, f.request), />= 0/);
    assert.deepEqual(
      f.calls.map((c) => (c.body as { items: { quantity: number }[] }).items[0].quantity),
      [5, 0]
    );
  });

  it("fails clearly without any list", async () => {
    const request = (async () => []) as never;
    await assert.rejects(getBasket({}, request), /no shopping lists/);
  });

  it("lists the shopping lists with a hint for several", async () => {
    const out = JSON.parse(await getShoppingLists(fake().request));
    assert.equal(out.count, 2);
    assert.deepEqual(out.lists[1], { shoppingListId: 22, name: "Party" });
    assert.match(out.hint, /ask/);
  });
});

describe("get_checkout_link", () => {
  it("names the list it summarised and says the link doesn't pick one", async () => {
    const out = JSON.parse(await getCheckoutLink({ shoppingListId: 11 }, fake().request));
    assert.equal(out.ok, true);
    assert.equal(out.shoppingListId, 11);
    assert.equal(out.listName, "Einkauf");
    assert.match(out.checkoutUrl, /^https:\/\/www\.migros\.ch\//);
    assert.match(out.listHint, /doesn't pick a list/);
  });

  it("says so when the basket is empty", async () => {
    const out = JSON.parse(await getCheckoutLink({ shoppingListId: 11 }, fake({ categories: [] }).request));
    assert.equal(out.ok, false);
  });
});
