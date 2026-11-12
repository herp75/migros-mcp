/**
 * Unit tests for the 2FA step: which code gets submitted.
 *
 * No network, no credentials. Uses the RFC 6238 test secret.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findError, otpCodeFor, totpFromSecret, FreshCodeRequiredError } from "../src/auth/login.js";

// RFC 6238 appendix B: the ASCII secret "12345678901234567890", base32-encoded.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const creds = { email: "test@example.com", password: "not-a-real-password" };

describe("totpFromSecret", () => {
  it("matches the RFC 6238 SHA-1 test vectors (last six digits)", () => {
    assert.equal(totpFromSecret(RFC_SECRET, 59), "287082");
    assert.equal(totpFromSecret(RFC_SECRET, 1111111109), "081804");
    assert.equal(totpFromSecret(RFC_SECRET, 1234567890), "005924");
  });

  it("ignores spaces, padding and lower case", () => {
    assert.equal(totpFromSecret("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==", 59), "287082");
  });

  it("rejects a secret with characters outside base32, without quoting the secret", () => {
    assert.throws(
      () => totpFromSecret("NOT-BASE32!", 59),
      (e: Error) => /not a valid setup key/.test(e.message) && !e.message.includes("!")
    );
  });
});

describe("otpCodeFor", () => {
  it("uses a code passed to authenticate", () => {
    assert.equal(otpCodeFor({ ...creds, totpCode: "123456" }), "123456");
  });

  it("prefers the passed code over the stored seed", () => {
    assert.equal(otpCodeFor({ ...creds, totpCode: "123456", totpSecret: RFC_SECRET }, 59), "123456");
  });

  it("makes the code from the stored seed when none is passed", () => {
    assert.equal(otpCodeFor({ ...creds, totpSecret: RFC_SECRET }, 59), "287082");
  });

  it("asks for a code when there is neither", () => {
    assert.throws(() => otpCodeFor(creds), FreshCodeRequiredError);
    assert.throws(() => otpCodeFor(creds), /authenticate tool/);
  });

  it("rejects a passed code that isn't six digits", () => {
    assert.throws(() => otpCodeFor({ ...creds, totpCode: "12345" }), /exactly six digits/);
    assert.throws(() => otpCodeFor({ ...creds, totpCode: "12345a" }), /exactly six digits/);
  });
});

describe("findError", () => {
  const page = (inner: string) => `<div class="info-message-error"><div>${inner}</div></div>`;

  it("returns the login page's error as plain text", () => {
    assert.equal(findError(page("Wrong <b>password</b>.\n Try again")), "Wrong password. Try again");
  });

  it("leaves no angle brackets, even from nested or broken tags", () => {
    const out = findError(page("a <scr<script>ipt>alert(1) b")) ?? "";
    assert.ok(!/[<>]/.test(out), out);
  });

  it("returns null when the page shows no error", () => {
    assert.equal(findError("<html></html>"), null);
  });
});
