# Phase 1 assessment: herp75/migros-mcp

State: fork of lewpgs/migros-mcp at `26306b3` (v0.5.1), checked 2026-11-12. Read-only review:
code read, `npm ci --ignore-scripts`, build, tests and `npm audit` run locally. Nothing was
sent to Migros. Plan: `~/code/mcp-server-plan.md`.

## 1. Upstream

- **lewpgs/migros-mcp:** TypeScript, about 3,000 lines in `src`, 137 stars.
  - Very active: v0.4.1, v0.5.0 and v0.5.1 were all released on 2026-11-08.
  - The maintainer merges outside PRs (#6 claw-w, #7 lukefx).
  - 1 open issue ("Coop"), no open PRs.
- **License:** `package.json` and `manifest.json` say MIT, but there is **no LICENSE file**. This is
  the same situation as with Cookidoo.
- **Distribution:**
  - npm `migros-mcp` via trusted publishing (OIDC), with provenance and staging that needs
    approval with 2FA;
  - a Claude Desktop `.mcpb` attached to the GitHub Release.
  - No Docker image, no MCP Registry entry.
- **Already good (keep it):**
  - **Network:** TLS is verified by default, with a TLS 1.3 minimum (also in the wrapper);
    `http.ts` follows no redirects; the transport is stdio only.
  - **Session:** stored in the config dir, written atomically with mode 600.
  - **Login safety:** solid handling of 429 rate limits (persisted cooldown, no fall-through
    from silent OAuth to a full login). The 2FA pre-check avoids half-finished logins.
  - **No spending:** checkout is a link only, nothing places orders.
  - **Update check:** opt-out, sends nothing about the user, size and timeout capped, only a
    version number reaches tool output.
  - **Desktop manifest:** marks password and TOTP secret as `sensitive`.
  - **CI and release:** Actions pinned by SHA, least privilege, `persist-credentials: false`,
    `npm ci --ignore-scripts`. The release workflow checks that version numbers agree and that
    the tag is on main. A weekly live check covers the tools that need no login.
  - 123 offline tests pass; line coverage 84 %.

## 2. Alternatives

| Project | Language | License | Relevance |
|---|---|---|---|
| aliyss/migros-api-wrapper (dependency) | TS | MIT | No install hooks, TLS 1.3 minimum, no telemetry. Pulls in `deepmerge` (low advisory) and `pino-pretty` |
| hczr-dev/m-connect | Python | MIT | About 100 tools. Write access to shopping lists, coupon activation, a dashboard. **Also places, authorizes and cancels orders and has a raw request passthrough: not to be ported** |
| nicktcode/swissgroceries-mcp | TS | PolyForm Shield 1.0.0 (not open source) | Compares several chains, no account. Feature ideas only, **no code reuse** |
| BabaStardust/migros-mcp | – | none | Copy of lewpgs, ignore |
| mohammad-abbasi-sh/migros-mcp | Python | MIT | Migros **Turkey**. Holds the name `migros-mcp` on PyPI and in the MCP Registry |
| edghyhdz/migros_api, EduardoDeMagalhaes/swiss-supermarket-api, damman01/ha-migros-list | Py | Apache-2.0 / MIT / MIT | Reference only (receipts, Cumulus, lists) |

Upstream already covers almost everything the others offer for one account. The only
feature gaps worth considering are from m-connect (MIT): writing to shopping lists (create,
rename, notes), activating Cumulus coupons, more receipt and Cumulus detail. The decision is
the user's.

## 3. Threat model (short)

- **Secrets:**
  - stored in env: `MIGROS_EMAIL`, `MIGROS_PASSWORD`, `MIGROS_TOTP_SECRET`. The TOTP secret
    makes 2FA a second password stored next to the first;
  - a typed 2FA code, never stored;
  - stored in `session.json`: SSO cookies and the JWT.
- **Account actions:** read the profile, addresses, orders, receipts and Cumulus data; change
  the basket. **No spending.** Worst realistic misuse through prompt injection: emptying or
  stuffing the basket, or leaking personal data (address, purchase history) into the chat.
- **Untrusted content:** product texts, Migusto recipes (scraped HTML) and order, receipt and
  coupon data, partly passed through raw.
- **Network:** www.migros.ch, login.migros.ch, migusto.migros.ch, registry.npmjs.org (update
  check).
- **Local resources:** only the config dir. No file input from the model.

## 4. Findings against the Phase 2 checklist

| # | Severity | Finding | Where |
|---|---|---|---|
| F1 | Medium | **No tool annotations at all.** Clients can't tell reads from writes. `remove_from_basket` and `update_basket_quantity` (0 removes) have no `destructiveHint` | `src/register.ts:26` (`server.tool` without annotations) |
| F2 | Medium | **No serialisation of the login and session.** Every call reads and writes `session.json` itself. Parallel tool calls can each start a full login (the code itself warns that half-finished logins get the IP blocked) and overwrite each other's cookies | `src/auth/index.ts:41`, `src/auth/api.ts:68-72` |
| F3 | Medium | **Raw passthrough of untrusted data:** `get_order_details`, `get_orders`, `get_in_store_receipts`, `get_cumulus_coupons` and `get_cumulus_status` (`raw:`) return Migros JSON unfiltered. There are no server instructions saying it is data | `src/auth-tools/orders.ts:50`, `cumulus.ts:39` |
| F4 | Medium | **Input bounds:** `productIds` is an unbounded array; strings have no length limit; `shoppingListId`, `page` and `orderId` are not integer-checked or bounded. Together with the zod advisory (F9) this allows memory exhaustion through oversized inputs | `src/schemas.ts` |
| F5 | Low–Med | **No redaction layer:** error messages reach the model verbatim, including up to 200 characters of the response body. A bad TOTP secret prints the offending character of the secret | `src/register.ts:35`, `src/auth/api.ts:103`, `src/auth/login.ts:57` |
| F6 | Low–Med | **Login HTTP client has no timeout.** A hanging login.migros.ch blocks the tool call indefinitely | `src/auth/oauth.ts:20` |
| F7 | Low | **The login flow follows any host:** it uses redirect `Location`s and the form `action` from the HTML, and **the password is POSTed to the form action URL**. It should be pinned to `login.migros.ch` / `www.migros.ch` (defence in depth; TLS protects today) | `src/auth/login.ts:166,178,206` |
| F8 | Low | The config dir is created without mode 700 (only the file is 600) | `src/auth/cookies.ts:58` |
| F9 | High (dependency) | `npm audit`: **zod <4.6.6, memory exhaustion (high)**. The fix needs **zod 4 (major)**. Also `deepmerge` prototype poisoning (low) through migros-api-wrapper | `package.json` |
| F10 | Low | Caret ranges on all dependencies (the lock file mitigates). `engines: >=18`, but CI tests 22/24 and the README says 22 | `package.json` |

## 5. Gaps against Phases 3–R

- **CI:**
  - no linter or formatter, no coverage floor;
  - no `npm audit`, gitleaks, CodeQL, dependency review or forbidden-pattern guard;
  - no Dependabot;
  - auth code coverage only 52–65 % (`oauth.ts`, `api.ts`, `login.ts`, `cart.ts`).
- **Tests:** no tool-contract snapshot (names and annotations); no protocol-level tests with
  an in-memory client, which needs checking in `server-tools.test.ts`.
- **Live tests:** only anonymous tools, weekly. Logged-in tests need a dedicated test account.
  Migros rate-limits logins at Cloudflare, so live tests must log in once per run and reuse
  the session.
- **Docs:** no LICENSE, SECURITY.md, CONTRIBUTING.md, NOTICE or architecture doc. The README
  already has "Privacy and safety" and tool sections.
- **Release:**
  - a fork must not publish to npm as `migros-mcp`. Needs its own name, for example
    `@herp75/migros-mcp`, or no npm package at all;
  - the MCP Registry name would be `io.github.herp75/migros-mcp` (free);
  - no container image yet;
  - the server version string is duplicated in `src/index.ts` (the release workflow checks it).

## 6. Proposed phases and estimate

| Phase | Content | Size |
|---|---|---|
| 2 security-baseline | F1 annotations plus snapshot test; F2 one in-process lock (single-flight login, serialised session writes); F3 filtered output and server instructions; F4 bounds; F5 `redact()` for password, email, TOTP secret, JWT and cookies in all forms; F6 timeouts; F7 host pinning; F8 dir 700; LICENSE and SECURITY.md | 1–1.5 days |
| 3 ci-hardening | security workflow (npm audit, gitleaks, guard), CodeQL, dependency review, Dependabot, coverage floor, lint and format (convention to decide), engines aligned | 0.5 day |
| 4 features | only what the user picks (see §2) | open |
| L live-tests | logged-in read tests plus basket write tests on a temporary product, cleaned up; `live` environment | 0.5–1 day |
| D docs | SECURITY, CONTRIBUTING, architecture, NOTICE, README security and config tables | 0.5 day |
| R release | own name and channel, registry, optional container, version from `package.json` | 0.5 day |
| U upstream | issue with offer and LICENSE suggestion; upstream-changes watcher | small |

## 7. Decisions (made by the user, 2026-11-12)

1. **zod 4:** upgrade in Phase 2, as its own commit with tests.
2. **Basket removals:** `destructiveHint` only, no `confirm`.
3. **Features from m-connect:** edit shopping lists; activate Cumulus coupons; more receipt and
   Cumulus detail where the API allows. Placing, authorizing or cancelling orders stays excluded.
4. **Release channel:** container on GHCR plus an MCP Registry entry (`io.github.herp75/migros-mcp`).
   No npm package for the fork.
5. **Lint and format:** ESLint and Prettier (offered upstream as a separate PR).
6. **Test account:** a dedicated Migros test account **with 2FA**. Its setup key goes into the live
   secrets next to email and password.
7. **Upstream issue:** decided at the end, as with mcp-cookidoo.
