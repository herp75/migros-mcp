/**
 * Shopping lists (create, rename, delete, item notes) and Cumulus coupons
 * (activate, deactivate, list). No network: each tool gets a fake request
 * that records the calls and answers like Migros did on the test account.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createShoppingList, deleteShoppingList, renameShoppingList, setItemNote } from "../src/auth-tools/lists.js";
import { formatCoupon, getCumulusBons, getCumulusCoupons, setCouponActive } from "../src/auth-tools/cumulus.js";

type Call = { method: string; path: string; body?: unknown };

function fake(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const request = async (method: string, path: string, body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call);
  };
  return { calls, request: request as never };
}

const OVERVIEW = [
  { shoppingListId: 11, shoppingListName: "Einkauf", itemsCount: 3, isOwner: true },
  { shoppingListId: 22, shoppingListName: "Party", itemsCount: 5, isOwner: true },
];

describe("shopping lists", () => {
  it("creates a list and returns its id", async () => {
    const f = fake(() => ({ shoppingListId: 33 }));
    const out = JSON.parse(await createShoppingList({ name: "Wochenende" }, f.request));
    assert.equal(out.shoppingListId, 33);
    assert.deepEqual(f.calls, [
      { method: "POST", path: "/shopping-list/public/v1/list", body: { name: "Wochenende" } },
    ]);
  });

  it("fails clearly when Migros returns no id", async () => {
    const f = fake(() => null);
    await assert.rejects(createShoppingList({ name: "x" }, f.request), /did not return the new list's id/);
  });

  it("renames with the website's body and says from what to what", async () => {
    const f = fake((c) => (c.method === "GET" ? OVERVIEW : null));
    const out = JSON.parse(await renameShoppingList({ shoppingListId: 22, name: "Grillfest" }, f.request));
    assert.deepEqual([out.from, out.to], ["Party", "Grillfest"]);
    assert.deepEqual(f.calls[1], {
      method: "PUT",
      path: "/shopping-list/public/v1/list/rename",
      body: { shoppingListId: 22, shoppingListName: "Grillfest" },
    });
  });

  it("refuses an unknown list id", async () => {
    const f = fake(() => OVERVIEW);
    await assert.rejects(renameShoppingList({ shoppingListId: 99, name: "x" }, f.request), /no shopping list 99/);
  });

  it("deletes only with confirm: true", async () => {
    const f = fake((c) => (c.method === "GET" ? OVERVIEW : null));
    const refused = JSON.parse(await deleteShoppingList({ shoppingListId: 22 }, f.request));
    assert.equal(refused.deleted, false);
    assert.match(refused.message, /"Party" with its 5 items.*can't be undone/);
    assert.ok(
      f.calls.every((c) => c.method === "GET"),
      "nothing may be deleted without confirm"
    );

    const done = JSON.parse(await deleteShoppingList({ shoppingListId: 22, confirm: true }, f.request));
    assert.equal(done.deleted, true);
    assert.deepEqual(f.calls.at(-1), {
      method: "DELETE",
      path: "/shopping-list/public/v1/list/delete/22",
      body: undefined,
    });
  });

  it("never deletes the only list", async () => {
    const f = fake((c) => (c.method === "GET" ? [OVERVIEW[0]] : null));
    await assert.rejects(deleteShoppingList({ shoppingListId: 11, confirm: true }, f.request), /only shopping list/);
    assert.ok(f.calls.every((c) => c.method === "GET"));
  });

  it("sets a note and keeps the item's quantity and type", async () => {
    const details = { categories: [{ items: [{ id: "100049709", type: "PRODUCT", quantity: 2 }] }] };
    const f = fake((c) => (c.path.includes("overview") ? OVERVIEW : c.path.includes("details") ? details : null));
    const out = JSON.parse(await setItemNote({ productId: "100049709", note: "laktosefrei" }, f.request));
    assert.equal(out.quantity, 2);
    assert.deepEqual(f.calls.at(-1), {
      method: "PUT",
      path: "/shopping-list/public/v3/items",
      body: { shoppingListId: 11, items: [{ id: "100049709", quantity: 2, type: "PRODUCT", note: "laktosefrei" }] },
    });
  });

  it("won't note a product that isn't in the list", async () => {
    const f = fake((c) => (c.path.includes("details") ? { categories: [] } : OVERVIEW));
    await assert.rejects(setItemNote({ productId: "1", note: "x", shoppingListId: 22 }, f.request), /not in this list/);
    assert.ok(f.calls.every((c) => c.method === "GET"));
  });
});

const COUPON = {
  ean: "2099590381949",
  uniqueId: "u-1",
  name: "20% auf Kaffee",
  status: "AVAILABLE",
  activationDisabled: false,
  discountAmount: 20,
  discountType: "PERCENT",
  backgroundHexColor: "#ffffff",
  expiryDate: "2026-12-01",
};

describe("Cumulus coupons", () => {
  it("lists coupons without display data, and says which can be activated", async () => {
    const f = fake(() => [COUPON, { ...COUPON, ean: "2", activationDisabled: true }]);
    const out = JSON.parse(await getCumulusCoupons(f.request));
    assert.equal(out.count, 2);
    assert.equal(out.coupons[0].canActivate, true);
    assert.equal(out.coupons[1].canActivate, false);
    assert.equal(out.coupons[0].backgroundHexColor, undefined);
    assert.deepEqual(formatCoupon({ status: "ACTIVE" }).canActivate, false);
  });

  it("activates by ean, the way the website does", async () => {
    let status = "AVAILABLE";
    const f = fake((c) => {
      if (c.method === "POST") status = c.path.endsWith("/activate") ? "ACTIVE" : "AVAILABLE";
      return c.method === "GET" ? [{ ...COUPON, status }] : null;
    });
    const out = JSON.parse(await setCouponActive({ ean: COUPON.ean }, true, f.request));
    assert.deepEqual([out.status, out.changed], ["ACTIVE", true]);
    assert.deepEqual(f.calls[1], {
      method: "POST",
      path: "/retentionapi/public/web/v1/cumulus-coupons/2099590381949/activate",
      body: {},
    });

    const back = JSON.parse(await setCouponActive({ ean: COUPON.ean }, false, f.request));
    assert.equal(back.status, "AVAILABLE");
    assert.ok(f.calls.some((c) => c.path.endsWith("/deactivate")));
  });

  it("does nothing for a coupon already in the wanted state", async () => {
    const f = fake(() => [{ ...COUPON, status: "ACTIVE" }]);
    const out = JSON.parse(await setCouponActive({ ean: COUPON.ean }, true, f.request));
    assert.equal(out.changed, false);
    assert.ok(f.calls.every((c) => c.method === "GET"));
  });

  it("refuses a coupon Migros doesn't allow, and an unknown ean", async () => {
    const f = fake(() => [{ ...COUPON, activationDisabled: true }]);
    await assert.rejects(setCouponActive({ ean: COUPON.ean }, true, f.request), /does not allow/);
    await assert.rejects(setCouponActive({ ean: "999" }, true, f.request), /no coupon with ean 999/);
    assert.ok(f.calls.every((c) => c.method === "GET"));
  });

  it("lists Cumulus bons", async () => {
    const f = fake(() => []);
    const out = JSON.parse(await getCumulusBons(f.request));
    assert.equal(out.count, 0);
    assert.equal(f.calls[0].path, "/retentionapi/public/web/v1/cumulus-bons");
  });
});
