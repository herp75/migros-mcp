/** Small guards from the November 2026 review: cookies, retries, dates, error pages. Offline. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestSetCookie, type Session } from "../src/auth/cookies.js";
import { notAboutTheToken } from "../src/migros.js";
import { swissDate } from "../src/auth-tools/cumulus.js";
import { findError } from "../src/auth/login.js";

describe("cookie jar", () => {
  const session = () => ({ cookies: { "login.migros.ch": { a: "1", b: "2", c: "3" } } }) as unknown as Session;

  it("removes cookies the server deletes", () => {
    const s = session();
    ingestSetCookie(s, "login.migros.ch", [
      "a=; Max-Age=0; Path=/",
      "b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "d=4; Max-Age=3600",
    ]);
    assert.deepEqual(s.cookies["login.migros.ch"], { c: "3", d: "4" });
  });

  it("Max-Age wins over an old Expires", () => {
    const s = session();
    ingestSetCookie(s, "login.migros.ch", "a=new; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60");
    assert.equal(s.cookies["login.migros.ch"].a, "new");
  });
});

describe("guest token retry", () => {
  it("doesn't retry when a new token can't help", () => {
    assert.equal(notAboutTheToken({ response: { status: 500 } }), true);
    assert.equal(notAboutTheToken({ response: { status: 404 } }), true);
    assert.equal(notAboutTheToken({ code: "ECONNABORTED" }), true);
    assert.equal(notAboutTheToken({ name: "TimeoutError" }), true);
  });

  it("retries on 401/403 and on errors that don't say", () => {
    assert.equal(notAboutTheToken({ response: { status: 401 } }), false);
    assert.equal(notAboutTheToken({ response: { status: 403 } }), false);
    assert.equal(notAboutTheToken(new Error("LeShop Token is undefined")), false);
    assert.equal(notAboutTheToken(null), false);
  });
});

describe("swissDate", () => {
  it("is already the next day in Zurich shortly after midnight", () => {
    // 23:30 UTC on 11 Nov is 00:30 on 12 Nov in Zurich (CET, UTC+1).
    assert.equal(swissDate(new Date("2026-11-11T23:30:00Z")), "2026-11-12");
    // Summer time, UTC+2.
    assert.equal(swissDate(new Date("2026-07-01T22:30:00Z")), "2026-07-02");
    assert.equal(swissDate(new Date("2026-07-01T12:00:00Z")), "2026-07-01");
  });
});

describe("findError", () => {
  it("returns null for an answer that isn't a page", () => {
    assert.equal(findError({ error: "json" }), null);
    assert.equal(findError(undefined), null);
  });
});
