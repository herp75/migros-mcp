import type { Credentials } from "../auth/index.js";
import { registerSecret } from "../security.js";

/**
 * Read credentials from env. Returns undefined if not all vars are set, in
 * which case the auth layer falls back to a cached session if one exists.
 */
export function credsFromEnv(totpCode?: string): Credentials | undefined {
  const email = process.env.MIGROS_EMAIL;
  const password = process.env.MIGROS_PASSWORD;
  if (!email || !password) return undefined;
  const totpSecret = process.env.MIGROS_TOTP_SECRET || undefined;
  // The email counts too: login pages and redirects can echo it back.
  for (const secret of [email, password, totpSecret, totpCode]) registerSecret(secret);
  return { email, password, totpSecret, totpCode };
}
