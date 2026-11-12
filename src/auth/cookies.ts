import crypto from "node:crypto";
import fs from "node:fs";
import { configDir, sessionFile } from "./paths.js";
import { registerSecret } from "../security.js";

/**
 * Cookie values shorter than this are flags and settings ("true", "de"), not
 * session secrets; masking them would garble ordinary text.
 */
const MIN_COOKIE_SECRET_LENGTH = 16;

/** Mask the session's token and cookie values in everything the server says. */
export function registerSessionSecrets(session: Session): void {
  registerSecret(session.jwt);
  for (const bag of Object.values(session.cookies)) {
    for (const value of Object.values(bag)) {
      if (value.length >= MIN_COOKIE_SECRET_LENGTH) registerSecret(value);
    }
  }
}

/**
 * Persisted auth state. Lives in the OS config dir, not in the project tree.
 *
 * - `cookies` is keyed by host so we can send the right Cookie header per request.
 * - `jwt` is the access token from /authentication/.../oauth/login-success (Bearer
 *   prefix already stripped by the caller).
 * - `jwtExp` is the JWT's `exp` claim in unix seconds, used to decide when to
 *   refresh proactively without parsing the token on every call.
 */
export interface Session {
  cookies: Record<string, Record<string, string>>;
  jwt: string | null;
  jwtExp: number; // unix seconds; 0 means "no JWT cached"
  /**
   * Unix epoch **milliseconds** when the login.migros.ch rate-limit cooldown
   * ends. Absent or 0 means the host is not known to be rate-limiting.
   */
  rateLimitedUntil?: number;
  /** Human-readable reason for the cooldown (carried from the 429 response). */
  rateLimitReason?: string;
  /** Consecutive 429s so far, used to step up the fallback backoff. */
  rateLimitAttempts?: number;
  /** The last full login hit a 2FA step. Not a secret, just a yes/no. */
  twoFactorRequired?: boolean;
}

const EMPTY: Session = { cookies: {}, jwt: null, jwtExp: 0 };

/** Read the persisted session, or return an empty one if no file exists. */
export function loadSession(): Session {
  try {
    const raw = fs.readFileSync(sessionFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Session>;
    const session: Session = {
      cookies: parsed.cookies ?? {},
      jwt: parsed.jwt ?? null,
      jwtExp: parsed.jwtExp ?? 0,
      rateLimitedUntil: parsed.rateLimitedUntil,
      rateLimitReason: parsed.rateLimitReason,
      rateLimitAttempts: parsed.rateLimitAttempts,
      twoFactorRequired: parsed.twoFactorRequired,
    };
    registerSessionSecrets(session);
    return session;
  } catch (err) {
    // Missing file (ENOENT) or unreadable: treat as empty.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, cookies: {} };
    // Corrupted JSON: don't throw and crash the MCP — start fresh and let the user re-import.
    return { ...EMPTY, cookies: {} };
  }
}

/** Write the session atomically (temp file + rename) to avoid partial writes. */
export function saveSession(session: Session): void {
  registerSessionSecrets(session);
  const dir = configDir();
  // Only the user may list or read the saved login. mkdir's mode applies only
  // when it creates the folder, so tighten one that already exists too.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
  const finalPath = sessionFile();
  // Not just the pid: in a container it is always 1, so two containers sharing
  // the volume would write the same temp file.
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
}

/** True when the attributes of a Set-Cookie header delete the cookie. Max-Age wins over Expires. */
function deletes(attributes: string): boolean {
  let maxAge: string | undefined;
  let expires: string | undefined;
  for (const part of attributes.split(";")) {
    const eq = part.indexOf("=");
    const key = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    const val = eq < 0 ? "" : part.slice(eq + 1).trim();
    if (key === "max-age") maxAge = val;
    if (key === "expires") expires = val;
  }
  if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) return Number(maxAge) <= 0;
  if (expires !== undefined) {
    const t = Date.parse(expires);
    return !Number.isNaN(t) && t <= Date.now();
  }
  return false;
}

/**
 * Update the jar from a server's Set-Cookie response headers for a given host.
 * Mutates `session.cookies[host]` in place. Caller decides when to persist.
 */
export function ingestSetCookie(session: Session, host: string, setCookies: string | string[] | undefined): void {
  if (!setCookies) return;
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  const bag = (session.cookies[host] ??= {});
  for (const sc of list) {
    // Take the "name=value" pair before the first semicolon. Attributes like
    // Path, Domain and HttpOnly are discarded: we only send back what we got,
    // to the same host. Expiry is read only to see whether the server deletes
    // the cookie (Max-Age=0 or an Expires in the past).
    const semi = sc.indexOf(";");
    const pair = semi === -1 ? sc : sc.slice(0, semi);
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (deletes(semi === -1 ? "" : sc.slice(semi + 1))) delete bag[name];
    else bag[name] = value;
  }
}

/** Build the `Cookie:` request header for a host (empty string if no cookies). */
export function cookieHeader(session: Session, host: string): string {
  const bag = session.cookies[host];
  if (!bag) return "";
  return Object.entries(bag)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
