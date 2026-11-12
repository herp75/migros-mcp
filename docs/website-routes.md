# Website routes used by the account tools

Found in the JavaScript of www.migros.ch (November 2026) and checked once on a test account
before use. All are on `https://www.migros.ch`, with the Bearer token from the login.

## Shopping lists: `/shopping-list/public/`

| Tool | Method and path | Body | Answer |
|---|---|---|---|
| `get_shopping_lists` | `GET v1/lists/overview` | | `[{shoppingListId, shoppingListName, itemsCount, isOwner, collaborators, createdAt}]` |
| `get_basket` | `GET v2/list/details?shoppingListId=` | | `{shoppingListId, name, totals, categories: [{items}]}` |
| `add_to_basket` and the other item tools | `PUT v3/items` | `{shoppingListId, items: [{id, quantity, type, note?}]}` | the list, as in `v2/list/details` |
| `create_shopping_list` | `POST v1/list` | `{name}` | `{shoppingListId}` |
| `rename_shopping_list` | `PUT v1/list/rename` | `{shoppingListId, shoppingListName}` | empty |
| `delete_shopping_list` | `DELETE v1/list/delete/{id}` | | empty |

- An item's `note` stays when a later update only changes the quantity.
- Item types: `PRODUCT`, `INGREDIENT`, `GROUPED_PROMOTION`, `CATEGORISED_TERM`,
  `UNCATEGORISED_TERM`.
- **Free-text items are not supported yet:** the website takes their ids from elsewhere, and a
  made-up id is answered with `400 items.invalid_id`.
- **Not used:**
  - `DELETE v3/list/{id}` (empties a list);
  - invitations, collaborators and `leave`;
  - `v3/merge-guest`.

## Cumulus: `/retentionapi/public/web/`

| Tool | Method and path | Body | Answer |
|---|---|---|---|
| `get_cumulus_status` | `GET v1/cumulus-profile` | | `{cumulusNumber, cumulusCardOwner, members, memberships, periodToDatePointsBalance}` |
| `get_cumulus_coupons` | `GET v1/cumulus-coupons` | | `[{ean, uniqueId, name, subtitle, description, status, activationDisabled, discountAmount, discountType, minimumPurchase, expiryDate, …}]` |
| `activate_cumulus_coupon` | `POST v1/cumulus-coupons/{ean}/activate` | `{}` | empty; status `AVAILABLE` → `ACTIVE` |
| `deactivate_cumulus_coupon` | `POST v1/cumulus-coupons/{ean}/deactivate` | `{}` | empty; status `ACTIVE` → `AVAILABLE` |
| `get_cumulus_bons` | `GET v1/cumulus-bons` | | a list (empty on the test account) |
| `get_in_store_receipts` | `GET v1/receipts?startDate=&supermarketOnly=&limit=` | | a list |

- **Not used:**
  - `POST v1/cumulus-bons/redeem`, because it spends a voucher;
  - `v1/partner-coupons`;
  - `v1/customers/statistics`, which only gives `numberOfOrders`.
- **Receipt line items:** the website has no route for them. The Migros app has one, but
  this server doesn't pose as the app.
