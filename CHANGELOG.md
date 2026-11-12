# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Shopping lists:** `create_shopping_list`, `rename_shopping_list`, `delete_shopping_list` (only with `confirm: true`, never the only list) and `set_item_note` (keeps the quantity).
- **Cumulus:** `activate_cumulus_coupon` and `deactivate_cumulus_coupon` (by the coupon's `ean`; nothing is bought), and `get_cumulus_bons` (read only).
- All of them use the routes the migros.ch website itself calls (see `docs/website-routes.md`), checked on a test account. The live check covers them: a temporary list is created, renamed, given a noted item and deleted; a coupon is activated and deactivated again.

- Documentation: a **Settings** table in the README (every environment variable, with its default), a **Kind** column (reads, changes, deletes) in the tool table, `docs/architecture.md` (modules, login and session, a checklist for adding a tool) and `CONTRIBUTING.md` (checks, live-check rules, what never goes into an issue or commit).

- **Docker image** `ghcr.io/herp75/migros-mcp`: Node 24 Alpine pinned by digest, runs as an unprivileged user, no npm at runtime, the saved login in the volume `/config`, the npm update notice off. Built and scanned with Trivy on every pull request; pushed from `main` (`edge`) and from release tags, for amd64 and arm64, with provenance, SBOM and a keyless cosign signature.
- **Release workflow for this fork:** on a `vX.Y.Z` tag it checks that every version file and the CHANGELOG agree and that the tag is on `main`, runs CI and the security checks, pushes the image, creates the GitHub Release and publishes `server.json` to the MCP Registry as `io.github.herp75/migros-mcp`. Upstream's npm and `.mcpb` jobs are gone: the npm name belongs to upstream.
- Dependabot also updates the Docker base image.

### Changed

- `get_stock` says `inStock: null` (unknown) instead of `false` when Migros has no stock data.
- `get_in_store_receipts` uses Swiss time for "today", so receipts from just after midnight are included. It and `get_receipt_details` say plainly that line items aren't available and the link is the same for every receipt.
- `get_checkout_link` returns which list it summarised and says that the link doesn't pick a list.
- `get_cumulus_status` no longer passes the raw Cumulus profile on, only the selected fields.
- The update check (only when run from source) asks GitHub for this fork's latest release instead of npm for upstream's package. `package.json`, `manifest.json` and the README link to this fork; the server version is read from `package.json`.
- The guest token is fetched once for parallel calls, and a timeout or server error no longer triggers a second try with a new token.
- More robust: the anonymous HTTP client caps answers at 5 MB, a relative silent-login redirect works, a login answer that isn't HTML no longer crashes, cookies Migros deletes are removed from the saved login, and two containers sharing the volume no longer collide when saving it.
- Internal: the 429 handling is one helper, `src/types.ts` (unused) is gone, `@modelcontextprotocol/sdk` needs at least 1.32.2 (for zod 4), and the basket tools take a fake request in tests.

- `get_cumulus_coupons` returns each coupon's useful fields (name, texts, discount, minimum purchase, expiry, status, `ean`) plus `canActivate`, without colours and campaign data.
- An empty answer from Migros (rename, delete) no longer fails with a JSON error.

### Security

- **Logins run one at a time.** Tool calls that arrive together no longer each start their own Migros login (repeated half-finished logins get the IP blocked) or overwrite each other's saved cookies. A call whose token was rejected uses the token another call just got instead of refreshing again.
- **The login only talks to migros.ch over HTTPS.** It stops if a Migros page or redirect points anywhere else, and the email and password are only ever posted to `login.migros.ch`.
- **Secrets are masked in error messages:** email, password, setup key, access token, long cookie values, Bearer tokens, JWTs and OAuth codes, also URL-encoded or JSON-escaped. A setup key with a wrong character no longer shows that character.
- **Tools say what they do:** reads are marked read-only; `add_to_basket` (it replaces the quantity), `update_basket_quantity`, `remove_from_basket`, `rename_shopping_list`, `set_item_note` and `delete_shopping_list` destructive; `authenticate` and the coupon tools as changes. Clients use this to decide which calls need approval.
- **`authenticate` without a code no longer repeats doomed logins.** On a 2FA account without a setup key, it sends the password once; further calls without a code within 60 s answer `fresh_code_required` without contacting Migros.
- `authenticate` no longer suggests that the AI read the 2FA code from a password manager: the user types it.
- **The server tells the client** that product, recipe, order and receipt data are information to show, not instructions to follow.
- **Inputs are bounded:** ids must be plain ids (no `/`, `?` or `..`), at most 50 products per call, search texts up to 200 characters, quantities up to 999, page and offset numbers capped.
- The login requests time out after 20 seconds instead of waiting forever.
- **After a failed login, the next tool calls wait a minute** instead of each starting a new login at once (ten calls meant ten half-finished logins in seconds, which gets the IP blocked). `authenticate` with a fresh 2FA code still tries right away.
- When Migros answers the login with Cloudflare's bot check (from servers and VPNs), the error says so instead of "could not find CSRF token".
- The folder holding `session.json` is now only readable by you (700), also when it already existed.
- zod 4: fixes a memory exhaustion advisory in zod 3.

### Added

- `LICENSE` (MIT, as `package.json` already said) and `SECURITY.md`.
- ESLint (including the checks for unhandled promises) and Prettier, with `npm run lint`, `format`, `format:check`, `typecheck` and `test:coverage`. The code was formatted once in its own commit, listed in `.git-blame-ignore-revs`.
- CI also type-checks the tests, lints, checks formatting and fails below 80 % line coverage of `src/`.
- Security workflow (on every pull request, push to main and weekly): `npm audit` (fails on high), gitleaks secret scan, a guard against turned-off TLS certificate checks or listening on all interfaces, and a dependency review on pull requests (fails on high, refuses GPL/AGPL).
- CodeQL for TypeScript and the GitHub workflows.
- Dependabot for npm and GitHub Actions, weekly, grouped, with a two-week cooldown for new releases.

- Live check with a test account (`npm run live-account`, `scripts/live-account-check.mjs`): every tool that needs a login, and with `--write` a basket round trip (add, checkout link, change quantity, remove) that checks the basket ends up as before. Credentials from the environment or `.env.live` (read literally), the test login kept in `.live-session/`, output without personal data. Migros blocks logins from GitHub's servers (Cloudflare bot check), so the weekly run happens on a computer: `scripts/migros-live-check.sh` with systemd user units in `scripts/systemd/`. The `live` workflow on GitHub (protected `live` environment) can be started by hand.

### Changed

- The README installs this fork from its Docker image, with the login in an env file only you can read. The npm package and the `.mcpb` installer are upstream's.
- Needs Node.js 22 or newer (`engines`), as the README and CI already said.

## [0.5.1] - 2026-11-08

### Fixed

- **`get_cumulus_status` works again.** Migros moved the address it used, so it answered 404 for everyone. It now reads the Cumulus profile from the address the migros.ch website uses. It returns `pointsBalance` (points collected in the current period), `cumulusNumber`, `cardholder`, `memberships` and `isFamigrosMember`. Migros no longer sends a level or lifetime points, so `level`, `lifetimePoints` and `cardholderTitle` are gone, and `cumulusId` is now `cumulusNumber`. An account without a Cumulus card gets `hasCumulus: false` instead of an error.

### Changed

- The README is shorter and easier to follow: install steps per app (with Claude Desktop's current Settings path), one table for what to enter depending on how you sign in, and new "Privacy and safety" and "Troubleshooting" sections.

## [0.5.0] - 2026-11-08

### Fixed

- **Three tools that stopped working for everyone are back.** Migros moved two of the addresses this server used.
  - `get_categories` answered 404. It now reads the category tree from Migros's new address.
  - `search_recipes` and `get_recipe_products` got a web page instead of data, because Migusto (Migros's recipe site) moved to a new website and switched off its old API. `search_recipes` now reads Migusto's recipe list (the page its search box leads to), 24 recipes per page, with `limit` and `offset` working as before. `get_recipe_products` uses migros.ch's own recipe API, which has the same recipes and the same recipe ids. (migros.ch's API has a search too, but it ignores the search text.)
  - `get_recipe_details` kept working but always returned an empty `id`. It now returns the recipe's id, plus `url`, `description` and `nutrition`.
- `get_product_details` showed "CHF undefined" for a product Migros lists without a price (for example out of season). The price is now left out instead.

### Changed

- **`get_recipe_products` returns products, not just ids.** Before: `{ productIds }`, Migusto's raw list. Now: `recipeId`, `title`, `count`, `total`, `products` (each with `uid`, `migrosId`, `name`, `brand`, `price`, `quantity` where Migros knows them) and `productIds`, which now holds the **uids** that `add_to_basket` takes. The products are the ones Migusto suggests for the recipe under "Zutaten in deiner Migros". `recipeId` must be the numeric id from `search_recipes`.
- `search_recipes` keeps its fields. `url` now points at the new Migusto address (`/de/rezepte/<slug>/<id>`), `image` is a 640-pixel-wide picture and `total` is the number of matching recipes. If `offset` and `limit` reach past the page Migusto sends, fewer recipes come back; ask again from the next offset.

### Security

- Dependencies refreshed within their existing version ranges (`npm audit fix`), which clears 16 of 19 known advisories. Most were in parts of the MCP SDK this server doesn't use (its HTTP server), and npx installs already picked up the newer versions on their own. The Claude Desktop installer is built from the lockfile, so it gets them with the next release. The three left need breaking upgrades (zod 4) or come through migros-api-wrapper, and are low risk here.

### Added

- **Update notice.** The Claude Desktop installer (`.mcpb`) doesn't update itself, so its users didn't know when a fix was out. About once a day, while a tool is in use, the server now asks the npm registry for the latest version number, in the background. When a newer one is out, one tool result a day ends with a separate line saying so, with a link to the README's *Updating* section. Nothing about the user is sent, tools never wait for the check, and only a plain version number from the registry's answer is ever shown. To turn it off, untick the new *Tell me when a new version is out* box in the Claude Desktop installer's settings, or set `MIGROS_MCP_UPDATE_CHECK=false` anywhere else.
- The README now says which apps it works in: apps on your own computer, not claude.ai in a browser or the phone apps.
- GitHub Actions check: every pull request and every push to main is built and tested on Node 22 and 24, read-only and without secrets.
- A test that starts the server and checks it offers exactly the tools listed in `manifest.json`.

## [0.4.1] - 2026-11-08

### Fixed

- **Products sold only online can be found and added to the basket** (#8). Some products exist only in the Migros Online shop, for example "Partner" products marked "not available in stores". `search_products` now also asks the online shop's search and adds those products after the usual results, listed again in `onlineOnlyProductIds`. `get_product_details` adds their online price, a `partner` flag, availability and the website link (before, they came back without a price). They go into the basket with `add_to_basket` like any other product. If the online search fails, results are the same as before.

## [0.4.0] - 2026-11-08

### Added

- **`authenticate` tool**: log in with the current six-digit 2FA code instead of storing the TOTP seed. The AI asks the user for the code, or reads it from a password manager. `MIGROS_TOTP_SECRET` keeps working exactly as before.
- **`get_shopping_lists` tool**: lists the user's shopping lists by name, so the AI can work on the right one when there are several (#5). `get_checkout_link` now accepts `shoppingListId` too. With one list, nothing changes.

### Changed

- `MIGROS_TOTP_SECRET` is now optional for accounts with 2FA. Without it, authenticated tools return `fresh_code_required` when a login is needed. The MCP remembers that the account needs a code, so it doesn't send the password to Migros until it has one. A rejected code reports Migros' own reason.

### Fixed
- **429 Too Many Requests handling.** When `login.migros.ch` rate-limits the MCP (Cloudflare), the auth layer now:
  - Parses `Retry-After` headers and applies a cooldown persisted in `session.json`.
  - Never cascades a 429 from silent OAuth into a full credentialed login (they share the same host and throttle).
  - Fails open: a still-valid cached JWT is returned even during cooldown so tools keep working.
  - Raises the JWT refresh grace buffer from 60 s to 5 min to reduce silent-OAuth frequency.
  - Falls back to exponential backoff (30 s → 2 min → 10 min) when `Retry-After` is missing. The step resets after a successful login, or an hour after the last cooldown ended.
  - Caps a `Retry-After` cooldown at 1 hour.
  - Saves the cooldown when the token refresh after a 401 hits a 429, so the next call doesn't retry.
  - Surfaces a clear, actionable error when the JWT is expired AND the login host is rate-limited.
- Tests use a temporary config directory on every OS. Before, `npm test` on macOS or Windows overwrote the real `session.json`.

### Documentation
- The **Updating** section now says what npx actually does: recent npm versions check for the newest version each time npx starts, so updates land on the next launch (it said ~7 days before).
- Wording fixes across the README and this changelog.

## [0.3.1] - 2026-04-28

### Documentation
- Added an **Updating** section to the README explaining how releases reach users on each install path (unpinned `npx`, drag-installed `.mcpb`, or manually pinned configs). Triggered by the realization that pinned-version configs make every release require a manual user edit; the recommended install commands have always been unpinned.

## [0.3.0] - 2026-04-28

Major feature release: authenticated user tools (basket, orders, addresses, profile, Cumulus) and recipe search via Migusto. The 6 existing anonymous tools are unchanged and continue to work without credentials.

### Added

- **Authenticated tool suite (11 tools)**: opt-in via `MIGROS_EMAIL` / `MIGROS_PASSWORD` / `MIGROS_TOTP_SECRET` env vars. Anonymous tools work without these.
  - `get_profile`: logged-in customer's profile (name, email, language)
  - `get_addresses`: saved delivery and billing addresses
  - `get_basket`: items in the user's basket (Migros calls it a shopping list)
  - `add_to_basket`: add a product or set its target quantity
  - `update_basket_quantity`: set an item's exact quantity (0 to remove)
  - `remove_from_basket`: convenience wrapper for quantity 0
  - `get_orders`: list online orders, paginated, filterable by status
  - `get_order_details`: full details of one order by id
  - `get_checkout_link`: URL to open in browser to complete checkout (we don't automate payment for safety)
  - `get_cumulus_status`: Cumulus loyalty card (points balance, level, cardholder)
  - `get_in_store_receipts`: list of in-store Kassenbons over a date range
  - `get_receipt_details`: URL to view a receipt's line items in the browser
  - `get_cumulus_coupons`: active personalized Cumulus coupons

- **Recipe tools (3 anonymous tools)**: Migusto integration:
  - `search_recipes`: free-text or ingredient-based search of Migusto's catalogue
  - `get_recipe_details`: full Schema.org recipe by slug
  - `get_recipe_products`: Migros product UIDs the recipe needs, ready to chain into `add_to_basket`

- **OAuth + session persistence**: first auth call runs a credentialed login (email → password → TOTP) and caches cookies + access token. JWT refreshes silently every ~30 min using cached cookies, so subsequent MCP launches don't re-authenticate. Full re-login happens roughly twice a year (when SSO cookies expire). Session lives at:
  - macOS: `~/Library/Application Support/migros-mcp/session.json`
  - Linux: `$XDG_CONFIG_HOME/migros-mcp/session.json`
  - Windows: `%APPDATA%/migros-mcp/session.json`

- **`manifest.json`** for Claude Desktop `.mcpb` install with sensitive `user_config` entries (credentials stored in OS keychain by Claude Desktop).

- **`CHANGELOG.md`** (this file).

### Changed

- README rewritten to document the dual-tier model (anonymous + authenticated) and the order-placement hand-off.
- `src/index.ts` refactored from 470 lines of try/catch boilerplate to 167 lines of declarative `register()` calls.
- Schemas consolidated in `src/schemas.ts` (previously some inline in `index.ts`).
- Authenticated tool implementations split by domain into `src/auth-tools/{account,cart,orders,cumulus}.ts` for easier maintenance.

### Limitations (documented in README)

- 2FA support is TOTP-only. Passkey-only accounts are not yet supported.
- Order placement is intentionally not automated; `get_checkout_link` hands off to the browser.
- In-store receipt line items aren't available via the public API; `get_receipt_details` returns a browser URL instead.
- If the credentialed login is repeatedly retried in a short window (e.g. wrong password retries), Cloudflare may briefly throttle the IP. Wait an hour or refresh via the browser.

## [0.2.1] - 2026-04-28

### Added

- `get_product_details` now accepts the 12-digit `migrosId` in addition to the shorter `uid`. Output also exposes `migrosId` for cross-referencing with `migusto.migros.ch` URLs.

## [0.2.0] - earlier

Initial public release with 6 anonymous tools: `search_products`, `get_product_details`, `get_stock`, `get_categories`, `search_stores`, `get_promotions`.
