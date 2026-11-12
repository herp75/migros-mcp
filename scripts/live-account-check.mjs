#!/usr/bin/env node
// Live check with a Migros account: starts the built server (dist/index.js)
// with a dedicated TEST account and calls every tool that needs a login
// against the real Migros website. With --write it also changes the basket:
// it adds a product that isn't in it, changes the quantity, removes it again,
// and checks that the basket is exactly as before. Exits 1 if anything fails.
//
// Never run it with your own account. Credentials come from the environment
// (MIGROS_TEST_EMAIL, MIGROS_TEST_PASSWORD, MIGROS_TEST_TOTP_SECRET) or from
// .env.live in the repo root, or the file MIGROS_LIVE_ENV_FILE names
// (git-ignored, mode 600, read literally: no $ expansion).
// The saved test login lives in .live-session/ (git-ignored), so repeated
// runs don't need a new login each time; Migros blocks frequent logins.
//
// Output names tools and counts only: no names, addresses or order data,
// because CI logs can be public.
//
// Usage: npm run build && npm run live-account [-- --write]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER = path.join(ROOT, "dist", "index.js");
const CALL_TIMEOUT_MS = 90_000;
const WRITE = process.argv.includes("--write");
const CI = Boolean(process.env.CI);

/** KEY=value lines, taken literally (quotes around the whole value are removed). */
function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  const mode = fs.statSync(file).mode & 0o077;
  if (mode && process.platform !== "win32") {
    console.error(`refusing to read ${path.basename(file)}: others can read it (chmod 600 it)`);
    process.exit(2);
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}

const fileEnv = readEnvFile(process.env.MIGROS_LIVE_ENV_FILE || path.join(ROOT, ".env.live"));
const test = (key) => process.env[key] || fileEnv[key] || "";
const email = test("MIGROS_TEST_EMAIL");
const password = test("MIGROS_TEST_PASSWORD");
const totpSecret = test("MIGROS_TEST_TOTP_SECRET");
if (!email || !password) {
  console.error("MIGROS_TEST_EMAIL and MIGROS_TEST_PASSWORD are needed (environment or .env.live)");
  process.exit(2);
}

const sessionDir = process.env.MIGROS_LIVE_SESSION_DIR || path.join(ROOT, ".live-session");
fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

// Only what the server needs: the test account, a separate config folder, no update notice.
const env = {
  PATH: process.env.PATH ?? "",
  HOME: sessionDir,
  XDG_CONFIG_HOME: sessionDir,
  APPDATA: sessionDir,
  MIGROS_EMAIL: email,
  MIGROS_PASSWORD: password,
  MIGROS_MCP_UPDATE_CHECK: "false",
};
if (totpSecret) env.MIGROS_TOTP_SECRET = totpSecret;

const server = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
server.stderr.on("data", () => {}); // may contain response details; not printed
const pending = new Map();
let nextId = 1;

createInterface({ input: server.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const waiter = pending.get(msg.id);
  if (waiter) {
    pending.delete(msg.id);
    waiter(msg);
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`no answer within ${CALL_TIMEOUT_MS / 1000} s`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

/** Call a tool and return its parsed JSON answer. Throws on a tool error. */
async function call(name, args = {}) {
  const result = await request("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  if (result?.isError) throw new Error(text || "tool returned an error");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`answer is not JSON (${text.length} characters)`);
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** The error, without anything personal: in CI only up to the first ": " (status line). */
function describe(err) {
  let text = String(err?.message ?? err).replace(/\s+/g, " ");
  for (const secret of [email, password, totpSecret].filter((s) => s.length >= 4))
    text = text.split(secret).join("[redacted]");
  if (CI) text = text.replace(/^(Error: )?([^:]*->\s*\d{3}).*$/, "$2");
  return text.slice(0, 300);
}

const results = [];
async function step(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`ok    ${name}${note ? `  (${note})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}  ${describe(err)}`);
  }
}

const basketItems = (basket) => (basket.items ?? []).map((i) => `${i.productId}x${i.quantity}`).sort();

let listId;
let before;
let orders = [];
let receipts = [];

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "live-account-check", version: "1" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  console.log(`server ${init.serverInfo?.name} ${init.serverInfo?.version}, writes ${WRITE ? "on" : "off"}`);

  await step("authenticate", async () => {
    const out = await call("authenticate");
    check(out.authenticated === true, "not authenticated");
    return totpSecret ? "with setup key" : "without 2FA";
  });
  // Without a login every other check fails the same way; stop instead of
  // sending Migros more login attempts.
  if (!results.at(-1).ok) throw new Error("login failed, the other checks were not run");

  await step("get_profile", async () => {
    const out = await call("get_profile");
    check(typeof out.email === "string", "no email in the profile");
    check(out.email.toLowerCase() === email.toLowerCase(), "the profile belongs to another account");
    return "the test account";
  });

  await step("get_addresses", async () => {
    const out = await call("get_addresses");
    check(Array.isArray(out), "not a list");
    return `${out.length} addresses`;
  });

  await step("get_shopping_lists", async () => {
    const out = await call("get_shopping_lists");
    check(Array.isArray(out.lists) && out.lists.length > 0, "no shopping list");
    listId = out.lists[0].shoppingListId;
    check(typeof listId === "number", "list without a numeric id");
    return `${out.lists.length} lists`;
  });

  await step("get_basket", async () => {
    check(listId, "skipped: no shopping list");
    const out = await call("get_basket", { shoppingListId: listId });
    check(Array.isArray(out.items), "no items list");
    before = out;
    return `${out.items.length} items`;
  });

  await step("get_checkout_link", async () => {
    const out = await call("get_checkout_link", listId ? { shoppingListId: listId } : {});
    check(typeof out.ok === "boolean", "no ok field");
    if (out.ok) check(/^https:\/\/www\.migros\.ch\//.test(out.checkoutUrl), "checkout link is not on www.migros.ch");
    return out.ok ? "link" : "basket empty";
  });

  await step("get_orders", async () => {
    const out = await call("get_orders");
    check(Array.isArray(out.orders), "no orders list");
    orders = out.orders;
    return `${out.orders.length} orders on page 0`;
  });

  await step("get_order_details", async () => {
    const order = orders[0];
    if (!order) return "skipped: no orders";
    const orderId = order.orderId ?? order.id ?? order.orderNumber;
    check(orderId !== undefined, "order without an id field");
    const out = await call("get_order_details", { orderId: String(orderId) });
    check(out && typeof out === "object", "no details");
    return "details present";
  });

  await step("get_in_store_receipts", async () => {
    const out = await call("get_in_store_receipts");
    check(Array.isArray(out.receipts), "no receipts list");
    receipts = out.receipts;
    return `${out.receipts.length} receipts in 30 days`;
  });

  await step("get_receipt_details", async () => {
    const receipt = receipts[0];
    const receiptId = receipt ? (receipt.id ?? receipt.receiptId ?? "1") : "1";
    const out = await call("get_receipt_details", { receiptId: String(receiptId) });
    check(typeof out.url === "string", "no url");
    return receipt ? "link" : "link (no receipt to try)";
  });

  await step("get_cumulus_status", async () => {
    const out = await call("get_cumulus_status");
    check(typeof out.hasCumulus === "boolean", "no hasCumulus field");
    return out.hasCumulus ? "card linked" : "no card";
  });

  await step("get_cumulus_coupons", async () => {
    const out = await call("get_cumulus_coupons");
    check(Array.isArray(out.coupons), "no coupons list");
    return `${out.coupons.length} coupons`;
  });

  if (WRITE) {
    let productId;
    try {
      await step("basket: pick a product not in the basket", async () => {
        check(before, "skipped: basket could not be read");
        const inBasket = new Set(before.items.map((i) => String(i.productId)));
        const found = await call("search_products", { query: "Vollmilch" });
        productId = (found.productIds ?? []).map(String).find((id) => !inBasket.has(id));
        check(productId, "every product found is already in the basket");
        return "found";
      });

      await step("add_to_basket", async () => {
        check(productId, "skipped: no product");
        const out = await call("add_to_basket", { productId, quantity: 1, shoppingListId: listId });
        const item = out.items.find((i) => String(i.productId) === productId);
        check(item, "product is not in the basket afterwards (id formats differ?)");
        check(item.quantity === 1, `quantity is ${item.quantity}, not 1`);
        return "quantity 1";
      });

      await step("get_checkout_link with an item", async () => {
        check(productId, "skipped: no product");
        const out = await call("get_checkout_link", { shoppingListId: listId });
        check(out.ok === true, "no checkout link for a basket with an item");
        check(/^https:\/\/www\.migros\.ch\//.test(out.checkoutUrl), "checkout link is not on www.migros.ch");
        return "link";
      });

      await step("update_basket_quantity", async () => {
        check(productId, "skipped: no product");
        const out = await call("update_basket_quantity", { productId, quantity: 2, shoppingListId: listId });
        const item = out.items.find((i) => String(i.productId) === productId);
        check(item && item.quantity === 2, `quantity is ${item?.quantity}, not 2`);
        return "quantity 2";
      });

      await step("remove_from_basket", async () => {
        check(productId, "skipped: no product");
        const out = await call("remove_from_basket", { productId, shoppingListId: listId });
        check(!out.items.some((i) => String(i.productId) === productId), "product is still in the basket");
        return "removed";
      });
    } finally {
      // Whatever happened above: the test product must not stay in the basket.
      await step("basket is as before", async () => {
        check(before, "skipped: basket could not be read");
        let after = await call("get_basket", { shoppingListId: listId });
        if (productId && !before.items.some((i) => String(i.productId) === productId)) {
          if (after.items.some((i) => String(i.productId) === productId)) {
            after = await call("remove_from_basket", { productId, shoppingListId: listId });
          }
        }
        check(
          JSON.stringify(basketItems(after)) === JSON.stringify(basketItems(before)),
          "the basket differs from before the test"
        );
        return `${after.items.length} items`;
      });
    }
  }
} catch (err) {
  console.log(`FAIL  server  ${describe(err)}`);
  results.push({ name: "server", ok: false });
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
