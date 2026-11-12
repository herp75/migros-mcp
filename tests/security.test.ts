/**
 * Security baseline: secrets never reach tool output, inputs are bounded, the
 * login only talks to Migros, logins run one at a time, and the saved session
 * is private. No network: the login client gets a fake axios adapter that
 * fails the test on any request it doesn't expect.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { clearSecrets, MASK, redact, registerSecret } from "../src/security.js";
import { register } from "../src/register.js";
import { credsFromEnv } from "../src/auth-tools/_shared.js";
import { client, migrosUrl } from "../src/auth/oauth.js";
import { fullLogin } from "../src/auth/login.js";
import { refreshJwt, serialized } from "../src/auth/index.js";
import { loadSession, saveSession, type Session } from "../src/auth/cookies.js";
import { sessionFile, configDir } from "../src/auth/paths.js";
import {
  AddToBasketSchema,
  GetOrderDetailsSchema,
  GetProductDetailsSchema,
  GetStockSchema,
  SearchProductsSchema,
  UpdateBasketQuantitySchema,
} from "../src/schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpConfig: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  clearSecrets();
  tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "migros-security-test-"));
  process.env.HOME = tmpConfig;
  process.env.APPDATA = tmpConfig;
  process.env.XDG_CONFIG_HOME = tmpConfig;
  assert.ok(sessionFile().startsWith(tmpConfig), "refusing to run: session file outside the temp dir");
});

afterEach(() => {
  client().defaults.adapter = undefined;
  process.env = { ...savedEnv };
  fs.rmSync(tmpConfig, { recursive: true, force: true });
});

interface Seen {
  method: string;
  url: string;
  data: string;
}

/** Answers login requests from a list of [matcher, response]; anything else fails the test. */
function fakeLogin(
  routes: Array<[RegExp, { status: number; headers?: Record<string, string>; data?: string }]>
): Seen[] {
  const seen: Seen[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    const method = (config.method ?? "get").toUpperCase();
    seen.push({ method, url, data: String(config.data ?? "") });
    const route = routes.find(([m]) => m.test(`${method} ${url}`));
    if (!route) throw new Error(`unexpected request: ${method} ${url}`);
    const [, r] = route;
    return { status: r.status, statusText: "", headers: r.headers ?? {}, data: r.data ?? "", config };
  };
  client().defaults.adapter = adapter;
  return seen;
}

const form = (action = "") => `<form method="post" action="${action}"><input name="_csrf" value="tok"></form>`;
const creds = { email: "someone@example.org", password: "pa ss$wörd-123" };

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe("redact", () => {
  it("masks a registered secret in every form it can take", () => {
    registerSecret(creds.password);
    registerSecret(creds.email);
    for (const form of [
      creds.password,
      encodeURIComponent(creds.password),
      encodeURIComponent(creds.password).replace(/%20/g, "+"),
      JSON.stringify(creds.password).slice(1, -1),
      JSON.stringify({ p: creds.password }).replace("ö", "\\u00f6"),
      "https://login.migros.ch/login?username=someone%40example.org&x=1",
    ]) {
      const out = redact(`before ${form} after`);
      assert.ok(!out.includes("ss$w") && !out.includes("someone"), out);
      assert.ok(out.includes(MASK), out);
    }
  });

  it("masks tokens and cookies that were never registered", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2hlcmU";
    for (const text of [
      `Authorization: Bearer abc.def-ghi`,
      `token ${jwt}`,
      `Cookie: SESSION=abcdef0123456789; other=1`,
      `{"set-cookie":"JSESSIONID=zzzzzzzzzzzzzzzz"}`,
      `https://www.migros.ch/x?code=secretcode123&state=xyz`,
    ]) {
      const out = redact(text);
      assert.ok(out.includes(MASK), out);
      assert.ok(!/abc\.def|c2lnbmF0|abcdef0123|zzzz|secretcode|xyz/.test(out), out);
    }
  });

  it("leaves ordinary text alone and ignores very short secrets", () => {
    registerSecret("de");
    assert.equal(redact("Milch 1 l, de"), "Milch 1 l, de");
  });

  it("credsFromEnv registers email, password and TOTP secret", () => {
    process.env.MIGROS_EMAIL = creds.email;
    process.env.MIGROS_PASSWORD = creds.password;
    process.env.MIGROS_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
    credsFromEnv();
    const out = redact(`${creds.email} ${creds.password} JBSWY3DPEHPK3PXP`);
    assert.equal(out, `${MASK} ${MASK} ${MASK}`);
  });

  it("saved session tokens and long cookie values are registered", () => {
    saveSession({
      cookies: { "login.migros.ch": { SSO: "s".repeat(20), lang: "de" } },
      jwt: "jwt-value-1234",
      jwtExp: 1,
    });
    assert.equal(redact(`${"s".repeat(20)} jwt-value-1234 lang=de`), `${MASK} ${MASK} lang=de`);
  });

  it("tool errors are redacted before they reach the client", async () => {
    registerSecret(creds.email);
    let handler: ((args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>) | undefined;
    const fakeServer = {
      registerTool: (..._args: unknown[]) => {
        handler = _args[_args.length - 1] as typeof handler;
      },
    };
    register(fakeServer as never, "t", "Test", "test", {}, { readOnlyHint: true }, async () => {
      throw new Error(`login for ${creds.email} failed, Bearer abc123`);
    });
    const result = await handler!({});
    assert.equal(result.isError, true);
    assert.ok(!result.content[0].text.includes("someone") && !result.content[0].text.includes("abc123"));
  });
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

describe("input bounds", () => {
  const rejects = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
    assert.equal(schema.safeParse(value).success, false, JSON.stringify(value).slice(0, 80));

  it("ids that could change a Migros URL are rejected", () => {
    for (const bad of ["../profile", "1/2", "a?b=c", "https://evil.example", "", "x".repeat(41)]) {
      rejects(GetStockSchema, { productId: bad, storeId: "123" });
      rejects(GetOrderDetailsSchema, { orderId: bad });
    }
    assert.ok(GetStockSchema.safeParse({ productId: "100049709", storeId: "0025002" }).success);
  });

  it("lists, texts and numbers are bounded", () => {
    rejects(SearchProductsSchema, { query: "x".repeat(201) });
    rejects(GetProductDetailsSchema, { productIds: Array.from({ length: 51 }, (_, i) => String(i)) });
    rejects(GetProductDetailsSchema, { productIds: [] });
    rejects(AddToBasketSchema, { productId: "1", quantity: 1000 });
    rejects(UpdateBasketQuantitySchema, { productId: "1", quantity: -1 });
    rejects(AddToBasketSchema, { productId: "1", shoppingListId: 1.5 });
  });
});

// ---------------------------------------------------------------------------
// Login stays on migros.ch
// ---------------------------------------------------------------------------

describe("login hosts", () => {
  it("migrosUrl only accepts https addresses on migros.ch", () => {
    assert.equal(migrosUrl("https://login.migros.ch/x", "t").host, "login.migros.ch");
    for (const bad of [
      "http://login.migros.ch/x",
      "https://evil.example/login",
      "https://login.migros.ch.evil.example/",
      "https://evilmigros.ch/",
      "javascript:alert(1)",
      "not a url",
    ]) {
      assert.throws(() => migrosUrl(bad, "t"), /migros\.ch|valid address/, bad);
    }
  });

  it("a redirect away from migros.ch stops the login before the password is sent", async () => {
    const seen = fakeLogin([
      [/^GET https:\/\/login\.migros\.ch\/login$/, { status: 200, data: form() }],
      [
        /^POST https:\/\/login\.migros\.ch\/login\/email$/,
        { status: 302, headers: { location: "https://evil.example/login/password" } },
      ],
    ]);
    const session: Session = { cookies: {}, jwt: null, jwtExp: 0 };
    await assert.rejects(fullLogin(session, creds), /leads away from migros\.ch/);
    assert.ok(seen.every((r) => !r.data.includes("ss%24w") && !r.url.includes("evil")));
  });

  it("a password form that posts to another host is refused", async () => {
    const seen = fakeLogin([
      [/^GET https:\/\/login\.migros\.ch\/login$/, { status: 200, data: form() }],
      [/^POST https:\/\/login\.migros\.ch\/login\/email$/, { status: 302, headers: { location: "/login/password" } }],
      [
        /^GET https:\/\/login\.migros\.ch\/login\/password$/,
        { status: 200, data: form("https://www.migros.ch/steal") },
      ],
    ]);
    const session: Session = { cookies: {}, jwt: null, jwtExp: 0 };
    await assert.rejects(fullLogin(session, creds), /posts to www\.migros\.ch instead of login\.migros\.ch/);
    assert.ok(
      seen.every((r) => !r.data.includes("ss%24w")),
      "password must not have been sent"
    );
  });
});

// ---------------------------------------------------------------------------
// Logins one at a time
// ---------------------------------------------------------------------------

describe("serialized", () => {
  it("runs tasks one after another, and a failure doesn't block the next", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) =>
      serialized(async () => {
        order.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([slow("a", 30, true), slow("b", 1), slow("c", 1)]);
    assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["rejected", "fulfilled", "fulfilled"]
    );
  });

  it("refreshJwt reuses a token another call already refreshed", async () => {
    fakeLogin([]); // any request fails the test
    saveSession({ cookies: {}, jwt: "new-token-from-other-call", jwtExp: Math.floor(Date.now() / 1000) + 3600 });
    assert.equal(await refreshJwt("old-rejected-token"), "new-token-from-other-call");
  });
});

// ---------------------------------------------------------------------------
// Saved session is private
// ---------------------------------------------------------------------------

describe("session file", { skip: process.platform === "win32" }, () => {
  it("is 600 in a 700 folder, also when the folder existed with wider rights", () => {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o755 });
    fs.chmodSync(configDir(), 0o755);
    saveSession({ cookies: {}, jwt: null, jwtExp: 0 });
    assert.equal(fs.statSync(configDir()).mode & 0o777, 0o700);
    assert.equal(fs.statSync(sessionFile()).mode & 0o777, 0o600);
    assert.deepEqual(loadSession().cookies, {});
  });
});
