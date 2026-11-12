# migros-mcp

Lets Claude (and other AI apps) search [Migros](https://www.migros.ch) products, recipes, stores and promotions. Sign in, and it can also manage your basket and look up your orders, receipts and Cumulus points.

> **Unofficial.** Not made or supported by Migros. It uses the same behind-the-scenes addresses as the Migros website, so it can break whenever Migros changes them. Use at your own risk.

## Install

> **This is a fork.** [herp75/migros-mcp](https://github.com/herp75/migros-mcp) is [lewpgs/migros-mcp](https://github.com/lewpgs/migros-mcp) with security hardening, live tests and more tools (see the [CHANGELOG](CHANGELOG.md)). It comes as a **Docker image**, `ghcr.io/herp75/migros-mcp`, and is listed in the MCP Registry as `io.github.herp75/migros-mcp`. The npm package `migros-mcp` and the Claude Desktop installer `migros-mcp.mcpb` are upstream's version, not this one.

It runs on your own computer, so it works in desktop apps that can start a program: Claude Desktop, Claude Code, Cursor and similar. It doesn't work on claude.ai in a browser or in the Claude phone apps. You need [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io).

**Your login, in a file only you can read.** Skip this to only search.

```bash
install -m 600 /dev/null ~/.config/migros-mcp.env
"${EDITOR:-nano}" ~/.config/migros-mcp.env
```

```
MIGROS_EMAIL=you@example.com
MIGROS_PASSWORD=your-password
```

One line each, no quotes. `$`, `#` and quotes in the password are fine (Docker reads the file as written). For 2FA without being asked for codes, add `MIGROS_TOTP_SECRET=...` (see [Your Migros account](#your-migros-account)).

The saved login lives in the Docker volume `migros-mcp`, so it survives restarts. That matters: Migros blocks computers that sign in too often.

### Claude Code

```bash
claude mcp add migros -- docker run -i --rm \
  --env-file ~/.config/migros-mcp.env -v migros-mcp:/config \
  ghcr.io/herp75/migros-mcp:0.6
```

Leave out `--env-file …` to only search. With Podman, write `podman` instead of `docker`.

### Claude Desktop, Cursor and other apps

Add this to the app's MCP config file, with your home folder in the path:

- **Claude Desktop:** Settings > Developer > Edit Config
- **Cursor:** `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project)

```json
{
  "mcpServers": {
    "migros": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/home/you/.config/migros-mcp.env",
        "-v", "migros-mcp:/config",
        "ghcr.io/herp75/migros-mcp:0.6"
      ]
    }
  }
}
```

Other apps (VS Code, Windsurf, Zed and so on) run the same command but lay out their config a little differently. Check your app's MCP instructions.

### Checking the image (optional)

Each image is signed with [cosign](https://docs.sigstore.dev/cosign/), keyless, by the release workflow of this repository:

```bash
cosign verify ghcr.io/herp75/migros-mcp:0.6 \
  --certificate-identity-regexp '^https://github.com/herp75/migros-mcp/\.github/workflows/(docker|release)\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Check that it works

Start a new chat and ask: *"Search Migros for oat milk."*

## Your Migros account

Optional. Without it, product search, product details, stock, stores, promotions and recipes all work.

With it, Claude can also see and change your basket and shopping lists, look up your orders, in-store receipts and Cumulus points, and put Cumulus coupons on your card. It **never places an order or pays**. It gives you a checkout link, and you finish on migros.ch yourself.

What to enter depends on how you sign in to migros.ch:

| You sign in with | Enter |
|---|---|
| Email and password | Email and password. Done. Use a password you use nowhere else: the server keeps it in a file on your computer. |
| Email, password and a 6-digit code from an authenticator app | Email and password. When Claude needs to sign in, it asks you for the current code. That only happens when Migros ends the saved login, not in every chat. |
| The same, but you never want to be asked for a code | Email, password and your **setup key** (see below). |

<details>
<summary><b>Finding your setup key</b> (only needed for the last option)</summary>

<br>

The setup key (also called the TOTP secret) is **not** the 6-digit code. It's the long code, about 32 letters and digits like `JBSWY3DPEHPK3PXP...`, that you got when you first added Migros to your authenticator app. It never changes.

- **Saved in a password manager?** Open the Migros entry and look for an option like "View one-time password secret". If you see a link starting with `otpauth://`, the setup key is the part after `secret=`.
- **Not saved anywhere?** Migros only shows it while you set up 2FA. In your Migros account settings, remove 2FA and set it up again. Under the QR code is a box saying *"Or enter the following key in the authenticator app"*. Copy that key before you finish, and add the new entry to your authenticator app.

Add it as one more line, `MIGROS_TOTP_SECRET=...`, in `~/.config/migros-mcp.env` (see [Install](#install)).

</details>

Only codes from an authenticator app work. If your account uses a passkey only, or codes by SMS, add an authenticator app in your Migros account settings first.

## Settings

All settings are environment variables. With Docker, put them in `~/.config/migros-mcp.env` (see [Install](#install)). None is required.

| Variable | Default | What it does |
|---|---|---|
| `MIGROS_EMAIL` | none | Your Migros login email. Without email and password, only the tools without an account work. |
| `MIGROS_PASSWORD` | none | Your Migros password. Only ever sent to `login.migros.ch`. |
| `MIGROS_TOTP_SECRET` | none | The 2FA setup key, so you're never asked for a code. Works like a second password: keep it as safe. With it in the same file as the password, anyone who gets that file has both factors. |
| `MIGROS_MCP_UPDATE_CHECK` | on; off in the image | `false`, `0`, `off` or `no` turns off the daily check for a newer release of this fork on GitHub (only when run from source). |
| `MIGROS_API_WRAPPER_USERAGENT` | built in | Overrides the browser name sent with the searches that need no account. Rarely needed. |
| `XDG_CONFIG_HOME` (Linux), `APPDATA` (Windows) | the usual place; `/config` in the image | Where the saved login (`migros-mcp/session.json`) is kept. On a Mac it's always `~/Library/Application Support/migros-mcp/`. |

For development only: `MIGROS_TEST_EMAIL`, `MIGROS_TEST_PASSWORD`, `MIGROS_TEST_TOTP_SECRET`, `MIGROS_LIVE_ENV_FILE` and `MIGROS_LIVE_SESSION_DIR` (see [Development](#development)).

## What you can ask

Without an account:

- "Search Migros for protein bars"
- "What's the nutrition info for this product?"
- "Find Migros stores near Zurich"
- "What promotions does Migros have right now?"
- "Find me a risotto recipe"

With your account:

- "What's in my Migros basket?"
- "Add 2 litres of milk to my basket"
- "Add the ingredients for this recipe to my basket"
- "Show me my last 5 Migros orders"
- "How much did I spend at Migros last month?"
- "Which Migros stores did I shop at last month, and for how much?"
- "Which Cumulus coupons do I have? Activate the one for coffee."
- "Make a new shopping list for the weekend"
- "Give me the link to finish my checkout"

## Updating

`:0.6` follows the newest 0.6.x release (fixes only). To get it, pull the image and restart the app:

```bash
docker pull ghcr.io/herp75/migros-mcp:0.6
```

New features come with a new minor version (`:0.7`): change the tag in your config. Releases are listed on the [releases page](https://github.com/herp75/migros-mcp/releases) and in the [CHANGELOG](CHANGELOG.md). The image doesn't check for updates itself (`MIGROS_MCP_UPDATE_CHECK` is off in it).

## Privacy and safety

- Your email, password and setup key are only ever sent to Migros' own login page (`login.migros.ch`). A 6-digit code you give Claude is used for that one sign-in and never stored or logged.
- Your password and setup key sit in `~/.config/migros-mcp.env`, readable only by you, not in the app's config file.
- Once you're signed in, the saved login (cookies and an access token) stays on your computer, in `session.json` in the Docker volume `migros-mcp`. `docker volume rm migros-mcp` signs you out. Inside the volume, only the server's user can read it. (Run without Docker, it's in `~/.config/migros-mcp/` on Linux, `~/Library/Application Support/migros-mcp/` on a Mac, `%APPDATA%\migros-mcp\` on Windows.)
- Your email, password, setup key, cookies and access token are masked in error messages.
- Tools that change your basket are marked as such, so your app can ask you before running them. Leave that approval on.
- Give Claude the 6-digit code yourself. Don't let an AI that can act on your account also read your codes (for example from a password manager): then a text it reads could get it to sign in, and the second factor protects nothing.
- Product texts, recipes and order data come from Migros and other people. migros-mcp tells the AI to treat them as information, not as instructions.
- It never places orders or pays. `get_checkout_link` gives you a link, and you finish on migros.ch.
- Found a security problem? See [SECURITY.md](SECURITY.md).

## Troubleshooting

- **"Too many requests" or other sign-in errors.** Migros blocks computers that sign in too often. When that happens, migros-mcp stops trying for a while on its own (30 seconds at first, longer if it keeps happening) and keeps using your current login while it's still valid. The error says until when. Wait until then before trying again. Restarting the app over and over, or a wrong password, makes it worse.
- **Something that used to work fails.** Migros may have changed its website. Update to the newest version (see [Updating](#updating)), and if it still fails, [open an issue](https://github.com/herp75/migros-mcp/issues).

## Tools

These are what Claude calls behind the scenes. You don't need them to use it.

The **Kind** column says what a tool does to your account: *reads*, *changes* (nothing is lost) or *deletes* (removes or overwrites something). Your app uses this to decide when to ask you first. Keep that approval on for anything that isn't *reads*.

**Without an account** (all *reads*)

| Tool | What it does |
|---|---|
| `search_products` | Search products by name or keyword, including ones sold only online (such as "Partner" products). |
| `get_product_details` | Nutrition, ingredients, allergens, price and ratings. Online-only products also get their online price and a Partner flag. |
| `get_stock` | Whether a product is in stock at a given store. Updated once a day. "Unknown" when Migros has no data. |
| `get_categories` | All Migros product categories. |
| `search_stores` | Stores near a place, with addresses and opening hours. |
| `get_promotions` | Current promotions and deals. |
| `search_recipes` | Search Migusto, Migros' recipe site, by text and/or ingredients. German, French and Italian only. |
| `get_recipe_details` | A full recipe: ingredients, steps, photos, nutrition. |
| `get_recipe_products` | The Migros products Migusto suggests for a recipe, with name and price, ready for `add_to_basket`. |

**With your account**

| Tool | Kind | What it does |
|---|---|---|
| `authenticate` | changes | Sign in with the current 6-digit code. Only used when no setup key is saved. |
| `get_profile` | reads | Your name, email and language. |
| `get_addresses` | reads | Your saved delivery and billing addresses. |
| `get_shopping_lists` | reads | Your shopping lists by name, for people with more than one. |
| `create_shopping_list` | changes | Start a new, empty list. |
| `rename_shopping_list` | deletes | Give a list a new name (the old one is replaced). |
| `delete_shopping_list` | deletes | Delete a list with its items. Only after you confirm, and never your only list. |
| `get_basket` | reads | What's in your basket (a shopping list). |
| `add_to_basket` | deletes | Add a product (1 by default). If it's already there, its quantity is **replaced** by the new number, not added to. |
| `update_basket_quantity` | deletes | Set how many of an item you want (0 removes it). |
| `remove_from_basket` | deletes | Remove an item. |
| `set_item_note` | deletes | Add a note to an item, such as "laktosefrei" (replaces an earlier note). |
| `get_checkout_link` | reads | A link to finish checkout on migros.ch. The link is the same for every list: with several lists, check on migros.ch that the right one is shown. |
| `get_orders` | reads | Your online orders, page by page, filterable by status. |
| `get_order_details` | reads | One order in full. |
| `get_cumulus_status` | reads | Your Cumulus card: points collected this period, card number, cardholder, memberships. |
| `get_cumulus_coupons` | reads | Your current personal Cumulus coupons, and which can be activated. |
| `activate_cumulus_coupon` | changes | Put a coupon on your Cumulus card for your next purchase. Nothing is bought. |
| `deactivate_cumulus_coupon` | changes | Take a coupon off the card again. |
| `get_cumulus_bons` | reads | Your Cumulus bons (vouchers). You redeem them yourself at checkout. |
| `get_in_store_receipts` | reads | Your in-store receipts (Kassenbons) for a date range: store, date, amount, points. |
| `get_receipt_details` | reads | The link to the receipts page on migros.ch, where you open a receipt to see its items (the same link for every receipt; the items aren't available to this server). |

<details>
<summary><b>How it works</b></summary>

<br>

- **Without an account**, it uses [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) and the same addresses the Migros website calls, with a guest token it fetches at startup.
- **With an account**, it signs in at `login.migros.ch` the way a browser does (email, then password, then the 2FA code if your account has one) and saves the login. The access token only lasts a short while, so it's renewed quietly from the saved login, without signing in again. A full sign-in only happens when Migros ends the saved login.
- Saving the login matters because Migros' sign-in page sits behind Cloudflare, which blocks computers that sign in too often.
- Without a setup key, once it knows your account needs a code, it waits until Claude has one before sending your password. That way it never starts a sign-in it can't finish.

</details>

## Development

How the code is laid out, and how a tool is added: [docs/architecture.md](docs/architecture.md). How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/herp75/migros-mcp.git
cd migros-mcp
npm install
npm run build
npm test
```

Before a pull request, run the same checks as CI:

```bash
npm run typecheck      # TypeScript, including the tests
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format fixes it)
npm run test:coverage  # tests, failing below 80 % line coverage of src/
```

`git config blame.ignoreRevsFile .git-blame-ignore-revs` hides the one big formatting commit from `git blame`.

Check the tools that need no account against the live Migros website. GitHub also runs this every Monday, so a change on Migros' side shows up early:

```bash
npm run live-check
```

Check the tools that need an account, with a dedicated **test** account (never your own). Put its login in `.env.live` (git-ignored, `chmod 600`) as `MIGROS_TEST_EMAIL`, `MIGROS_TEST_PASSWORD` and, for 2FA, `MIGROS_TEST_TOTP_SECRET`. `--write` also adds a product to the basket, changes its quantity and removes it again, checking that the basket ends up as before. The test login is kept in `.live-session/`, so repeated runs don't sign in again each time.

Migros answers logins from GitHub's servers with a bot check, so this runs weekly on a computer instead: `scripts/migros-live-check.sh` pulls the published image (`edge`, built from `main`), checks its cosign signature, and runs the check with `--write` **inside that image** with rootless podman, so it tests what people install and nothing from the repo runs outside a container. It needs podman and [cosign](https://docs.sigstore.dev/cosign/system_config/installation/); the saved test login is kept in `~/.local/state/migros-live-check/`. To schedule it, copy `scripts/systemd/migros-live-check.service` and `.timer` to `~/.config/systemd/user/` and run `systemctl --user enable --now migros-live-check.timer`; results are in `journalctl --user -u migros-live-check`. The `live` workflow on GitHub can still be started by hand, to see whether GitHub's servers get through again.

```bash
npm run live-account              # read-only
npm run live-account -- --write   # with the basket round trip
```

Try it with the MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT, see [LICENSE](LICENSE).
