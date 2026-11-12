# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/herp75/migros-mcp/security/advisories/new),
not in a public issue. Don't include your Migros password, setup key, cookies or
`session.json` in a report.

## Supported versions

Only the latest release gets fixes.

## What this server holds and can do

- **Secrets:** your Migros email, password and, if you set it, your 2FA setup key
  (`MIGROS_TOTP_SECRET`, which works like a second password). After a login, cookies and an
  access token in `session.json`. The file can only be read by you (mode 600 in a folder only
  you can open, on Mac and Linux). Deleting it signs you out.
- **Where they go:** the email, password and 2FA code are only sent to `login.migros.ch` over
  HTTPS, with certificates always checked. The login stops if a Migros page or redirect points
  anywhere outside `migros.ch`. Error messages and tool results have these values masked.
- **What it can do on your account:** read your profile, addresses, orders, receipts and
  Cumulus data; change your basket and shopping lists (create, rename, delete a list only
  with an explicit confirmation, never the only one); put Cumulus coupons on your card and
  take them off. It **never places an order, pays or redeems a voucher**.
- **Transport:** stdio only. The server opens no network port.
- **Untrusted content:** product texts, recipes, reviews, order and coupon data come from
  Migros and other people. They are passed to the AI as data. The server tells the client
  not to follow instructions found in them. Keep your app's approval prompt on for tools that
  change the basket.
- **Other network traffic:** about once a day the server asks the npm registry for the newest
  version number (turn it off with `MIGROS_MCP_UPDATE_CHECK=false`). Nothing about you is sent.

## Using it safely

- Use a password for Migros that you use nowhere else.
- Prefer the Claude Desktop installer: it keeps the password and setup key in your computer's
  keychain. Config files of other apps keep them in plain text.
- Don't share `session.json` or your app's MCP config file.
