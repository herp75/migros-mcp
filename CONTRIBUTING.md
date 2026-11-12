# Contributing

Thanks for helping. A few rules keep this safe: the server holds people's Migros passwords and
can change their basket.

## Setup

Node.js 22 or newer.

```bash
git clone https://github.com/herp75/migros-mcp.git
cd migros-mcp
npm ci --ignore-scripts
npm run build
```

## Before a pull request

Run what CI runs:

```bash
npm run typecheck      # TypeScript, including the tests
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format fixes it)
npm run test:coverage  # all offline tests, failing below 80 % line coverage of src/
```

The offline tests never reach Migros. Keep it that way: pass a fake `request`, or a fake axios
adapter for the login code (see `tests/security.test.ts`).

If you change a tool's name or its annotation, update the snapshot on purpose and review the
diff:

```bash
UPDATE_SNAPSHOT=1 node --import tsx --test tests/server-tools.test.ts
```

How the code fits together, and a checklist for adding a tool: [docs/architecture.md](docs/architecture.md).

## Live checks

- `npm run live-check` calls the tools without an account against the real website. GitHub
  runs it every Monday.
- `npm run live-account [-- --write]` calls the tools with an account. Use **only a dedicated
  test account**, never your own:
  - Its login goes in `.env.live` (git-ignored, `chmod 600`) as `MIGROS_TEST_EMAIL`,
    `MIGROS_TEST_PASSWORD` and, for 2FA, `MIGROS_TEST_TOTP_SECRET`.
  - `--write` changes the basket, a temporary shopping list and one coupon, and puts
    everything back.
  - Migros blocks logins from cloud servers, so this runs on a computer, not on GitHub.
    `scripts/migros-live-check.sh` runs it weekly inside the published, signed image (podman,
    skopeo and cosign needed).
- Live checks print tool names and counts only. Don't add output with names, addresses or order
  data: logs get shared.

## Rules

- **Never** put a password, setup key, token, cookie, `session.json`, `.env.live` or a browser
  HAR file in an issue, a pull request, a commit or a test fixture. Fixtures are made up.
- TLS certificate checks stay on, and nothing listens on a network port. CI fails on
  `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` and `0.0.0.0`.
- Only the routes the migros.ch website calls. Don't use the Migros app's private API or keys
  taken from the app.
- No tool places an order, pays or redeems a voucher.
- Dependencies stay in the lock file (`npm ci`). New ones need a reason, and they must not be
  GPL/AGPL (dependency review fails on those).
- Changes go in `CHANGELOG.md` under `[Unreleased]` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).

Security problems: please report them privately, see [SECURITY.md](SECURITY.md).
