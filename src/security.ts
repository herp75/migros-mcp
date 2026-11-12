/**
 * Keeps secrets out of what the server says: tool results, errors and logs.
 *
 * Every secret the server holds (email, password, TOTP secret, access token,
 * cookie values) is registered here once it is known. `redact()` replaces each
 * of them, in every form it can take on the way out: as typed, URL-encoded
 * (a login form or a redirect URL), and JSON-escaped. Bearer tokens, JWTs and
 * Cookie headers are masked by pattern as well, so a value that was never
 * registered is still caught.
 */

export const MASK = "[redacted]";

/** Shorter values would mask ordinary words and numbers. */
const MIN_SECRET_LENGTH = 4;

const secrets = new Set<string>();

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>, also inside JSON or a log line
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${MASK}`],
  // Anything shaped like a JWT
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, MASK],
  // Cookie / Set-Cookie header values
  [/((?:set-)?cookie["']?\s*[:=]\s*["']?)[^"'\r\n]+/gi, `$1${MASK}`],
  // OAuth code, state and token parameters in URLs
  [/([?&](?:code|state|access_token|id_token|refresh_token)=)[^&#\s"']+/gi, `$1${MASK}`],
];

/** The forms a value can appear in on the way out. */
function formsOf(value: string): string[] {
  const forms = [value, encodeURIComponent(value), encodeURIComponent(value).replace(/%20/g, "+")];
  const json = JSON.stringify(value).slice(1, -1);
  forms.push(
    json,
    json.replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
  );
  return forms;
}

/** Remember a secret so that redact() masks it. Ignores empty and very short values. */
export function registerSecret(value: string | null | undefined): void {
  if (!value || value.length < MIN_SECRET_LENGTH) return;
  for (const form of formsOf(value)) secrets.add(form);
}

/** Mask every registered secret and every token-shaped value in a text. */
export function redact(text: unknown): string {
  let out = String(text);
  // Longest first, so a secret that contains another is masked whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(MASK);
  }
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** For tests only. */
export function clearSecrets(): void {
  secrets.clear();
}
