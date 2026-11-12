# Architecture

migros-mcp is an MCP server over **stdio**. It opens no network port. An AI app starts it as
a child process (`node dist/index.js`, or the Claude Desktop installer does it) and calls its
tools. It talks to Migros like a browser: the same addresses the migros.ch website calls,
over HTTPS with certificates always checked.

## Modules

| Path | Role |
|---|---|
| `src/index.ts` | The server: name, version (read from `package.json`), instructions for the client, and every tool registration (name, description, input schema, annotation, handler). |
| `src/register.ts` | `register()`: registers a tool with the SDK's `registerTool` (name, title, description, input schema, annotation), wraps its handler, turns its string into MCP content, turns a thrown error into an `isError` result that has gone through `redact()`, and adds the update notice. The annotation sets `READ_ONLY`, `WRITE`, `CREATE` and `DESTRUCTIVE`. |
| `src/schemas.ts` | zod input schemas for every tool, with the limits: plain IDs (`ID_PATTERN`), text and list lengths, number ranges. |
| `src/security.ts` | `registerSecret()` and `redact()`: masks email, password, setup key, token and cookie values in every form, plus Bearer tokens, JWTs, Cookie headers and OAuth codes by pattern. |
| `src/tools.ts`, `src/migros.ts`, `src/online.ts`, `src/categories.ts`, `src/recipes.ts` | Tools without an account. Products, stock and stores go through [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) with a guest token. Online-only products, categories and Migusto recipes go through `src/http.ts`. |
| `src/http.ts` | The plain HTTP client for www.migros.ch calls without a login: TLS 1.3, timeout, no redirects. |
| `src/auth/` | The login and the saved session (see below). |
| `src/auth-tools/` | Tools with an account, one file per area: `account`, `cart` (basket), `lists` (create, rename, delete, notes), `orders`, `cumulus` (card, coupons, bons, receipts). Each calls `api()`. The handlers in `lists` and `cumulus` take an optional `request` function, so tests can pass a fake. Follow that pattern for new ones. |
| `src/update-check.ts` | Asks the npm registry for the newest version at most once a day. Opt-out; only a version number reaches the tool output. |
| `scripts/live-check.mjs`, `scripts/live-account-check.mjs` | Live checks against the real website, without and with a test account (see CONTRIBUTING). |
| `docs/website-routes.md` | The website routes the account tools use, with bodies and answers. |

## Login and session

`src/auth/api.ts` `api(method, path, body)` is the only way the account tools reach Migros:

1. **`getJwt()`** (`src/auth/index.ts`) returns an access token. It runs through a queue
   (`serialized`), so parallel tool calls never log in twice.
   1. The cached JWT from `session.json`, if it's valid for more than 5 more minutes.
   2. Otherwise a **silent OAuth** refresh with the saved SSO cookies (`oauth.ts`).
   3. Otherwise a **full login** (`login.ts`): email, password, and the 2FA code from the setup
      key or from `authenticate`. Every step only goes to `https://*.migros.ch`, and the forms
      only to `login.migros.ch`.
2. The request goes out with `Authorization: Bearer`. New cookies are merged into the
   **freshly read** session file, so a login that finished meanwhile isn't overwritten.
3. On a **401**, `refreshJwt()` gets a new token, or the one another call already got, and the
   request is retried once.

**Protection against getting blocked.** `login.migros.ch` sits behind Cloudflare:

- A **429** sets a cooldown that's saved in the session (`rate-limit.ts`). During it, a valid
  JWT is still used, but no login is attempted.
- A **failed full login** (wrong password, bot check) blocks further logins for 60 s in this
  process. Only `authenticate` with a fresh code may try right away.
- If the last login needed a 2FA code and none is available, the password isn't even sent.

**Browser identity.** The login and account calls send a fixed Firefox user agent
(`src/auth/oauth.ts`) and the website's `peer-id` (`website-js-…`, `src/auth/api.ts`). When
Migros or Cloudflare start refusing calls that used to work, check these first: compare them
with what the current website sends.

**`session.json`** sits in `<config dir>/migros-mcp/`. It's written atomically with mode 600
in a folder with mode 700. It holds cookies, the JWT and the cooldown state. Its secrets are
registered for `redact()` when it's loaded or saved.

## Adding a tool

1. **Find the route** the website uses: in its JavaScript, or in the browser's network tab on a
   **test** account. Note only the method, path and body shape, never headers or cookies. Add it
   to `docs/website-routes.md`. Never use the Migros app's private API.
2. **Probe it once** on the test account before writing code against it.
3. **Schema** in `src/schemas.ts`. IDs with `id()`, lengths and numbers bounded. Destructive
   tools that lose more than one item take `confirm: boolean` and refuse without it.
4. **Handler** in the matching `src/auth-tools/*.ts` file. Take a `request` parameter that
   defaults to `api()`. Return compact JSON with the fields a person needs, not Migros' raw
   answer.
5. **Registration** in `src/index.ts` (`register()` calls the SDK's `registerTool`) with a short `title` and the right annotation. Reads are `READ_ONLY`.
   Anything that removes or overwrites is `DESTRUCTIVE`. A description says what it changes
   and what it never does.
6. **Manifest:** add the tool to `manifest.json` `tools` (the server test compares the two).
7. **Tests:** offline tests with a fake request (exact paths and bodies, refusals, errors).
   Then `UPDATE_SNAPSHOT=1 node --import tsx --test tests/server-tools.test.ts`. Review the
   diff of `tests/snapshots/tools.json`: it's the contract.
8. **Live check:** add a step to `scripts/live-account-check.mjs`. Writes only on temporary
   objects, undone in a `finally`, and printing no personal data.
9. **Docs:** README tool table (with its kind), CHANGELOG `[Unreleased]`.
