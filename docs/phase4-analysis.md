# Phase 4 analysis: features from m-connect

State: 2026-11-12. Read-only look at hczr-dev/m-connect (MIT, `11bd197`, 2026-11-04) and our
code. Nothing was sent to Migros for this.

## How m-connect gets these features

m-connect doesn't use the website's API, which migros-mcp uses. It uses the **Migros app's
private API**:

- **Gateway:** `https://mobile.www.migros.ch/mobile-api-gateway/public/…`, with a map of
  about 270 routes recovered from the app.
- **Login:** OAuth with the **app's own client ID**. `extract_oauth_secret()` can read the
  client secret **out of the app binary**.
- **Shopping-list items:** not on the gateway, but in **Google Cloud Firestore**. Access
  needs a Firebase Web API key **taken from the app bundle**
  (`GoogleService-Info.plist`) and a second login at Google Identity Toolkit.

**Verdict:** we don't follow that route.

- It poses as the official app, with secrets taken from a closed-source app. That's a step
  beyond using the website's own addresses, and more likely to conflict with Migros' terms.
- It would add a second login, a second token store and a new host (Google), which means more
  secrets to protect.
- It's more fragile: an app update changes the client, the key or the routes.

m-connect remains useful as a **map of what exists**, not as a source of code or of an
approach. Its code is Python, so nothing would be copied anyway. If ideas are taken from it, it
gets credited in NOTICE.

## The three features on the website API

| Feature | Today (website API) | App route (m-connect) | Website route | Can the test account test it? |
|---|---|---|---|---|
| Edit shopping lists (create, rename, delete lists, item notes) | `GET /shopping-list/public/v1/lists/overview`, `v2/list/details`, `PUT v3/items` | list items only via Firestore | **unknown**, to be found | yes (1 list, empty basket) |
| Activate and deactivate Cumulus coupons | `GET /retentionapi/public/web/v1/cumulus-coupons` | `POST /retentionapi/v1/customer/coupons/{ean}/activate` | **unknown** (probably next to `cumulus-coupons`) | **no:** no Cumulus card, 0 coupons |
| Receipt line items, Cumulus periods | `GET …/receipts` (list only). Line items are said to need account.migros.ch's older login | `GET /v1/customer/receipts/{id}/products`, `/v1/customer/cumulus-periods` | **unknown** (account.migros.ch) | **no:** no receipts |

## What has to happen first

1. **Find the website's routes for these actions.** Two ways that don't pose as the app:
   - **a. Search the website's public JavaScript.** Download the public JS files of
     www.migros.ch and account.migros.ch (anonymous, a few MB, no account involved) and search
     them for `shopping-list/public`, `cumulus-coupons` and `receipts`. That shows candidate
     paths and verbs.
   - **b. You record the calls.** In the browser on the **test account**: DevTools → Network,
     create, rename and delete a list, add a note. Then send me **only the method, the path and
     the shape of the request body**. Never the HAR file and never headers: they contain
     cookies and the token.

   a. is what I'd start with; b. confirms what a. finds. Each route is then probed once on the
   test account before code depends on it (ground rule 10).
2. **Test data for coupons and receipts.** Without a Cumulus card on the test account, coupon
   activation and receipt line items can't be tested live at all. Options:
   - link a Cumulus card to the test account, and make one small purchase in a shop with it;
   - or postpone these two features and do shopping lists only.

## Proposed order

1. **Shopping lists (4a):** route discovery, a probe on the test account, then tools:
   `create_shopping_list`, `rename_shopping_list`, `delete_shopping_list` (destructive, with
   `confirm=true`, because a whole list goes), and item notes. The live check gets a round
   trip: a temporary list is created, renamed and deleted.
2. **Coupons (4b)** and **receipts and Cumulus periods (4c):** only once the test account has
   a Cumulus card and coupons and receipts exist. Otherwise only the route discovery, and the
   features stay open.
