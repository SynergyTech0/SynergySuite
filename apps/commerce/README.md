# Synergy Commerce

Inventory, purchasing, point of sale and an online store in one app, posting to Books. It covers
the day-to-day parts of Dynamics 365 Commerce and Supply Chain for a small business.

- **Products**: one catalog with SKU, barcode, category, price, tax rate, image, reorder point and
  preferred vendor. CSV import.
- **Stock**: on-hand by location (stores and warehouses), counts, adjustments and transfers. Every
  change is a movement in one ledger, valued at moving-average cost.
- **Purchasing**: vendors, purchase orders (draft, placed, part received, received), receiving
  with cost updates, and draft orders from reorder suggestions.
- **Register** (`/pos`): open a shift with a float, scan or tap items, line and order discounts,
  card, cash with change, other tenders and split payment, printable receipts, pickups waiting for
  payment, refunds back to stock, and closing the drawer with over/short.
- **Online store** (`/store`): public catalog, cart and checkout for pickup or delivery, and an
  order status page per order. No suite account needed.
- **Books**: sales, refunds, deliveries and stock adjustments become balanced journal entries in
  Books; a delivery also becomes an approved vendor bill. They are queued in Commerce and retried
  until Books takes them, so Commerce keeps working when Books is down.

Staff sell, fulfil and receive deliveries. Managers also run products, stock, buying and refunds.
Admins also change settings. The first person to open the app is its admin.

## Settings

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres database for Commerce. Existing installs need `CREATE DATABASE commerce;` once. |
| `BOOKS_SVC_TOKEN` | The same token Books has. Empty = nothing is posted (postings wait in the queue). |
| `BOOKS_INTERNAL_URL` | Where Books answers inside the deployment (default `http://books:3055`). |
| `COMMERCE_SVC_TOKEN` | Lets other suite apps use the stock API below. Empty = off. |
| `COMMERCE_CHECKOUT_URL`, `COMMERCE_CHECKOUT_TOKEN` | A payment provider for online card payment (below). Empty = pay at pickup or on delivery. |

The account each kind of money posts to is set in Settings and defaults to Books' standard chart
(takings 1010, sales 4010, sales tax 2300, returns 4200, inventory 1200, cost of goods 5000,
payables 2000).

## Payment providers

Card processing is a paid service and is not part of this repository. Commerce speaks one small
protocol so any provider can be plugged in:

1. When a shopper checks out, Commerce sends `POST $COMMERCE_CHECKOUT_URL` with
   `Authorization: Bearer $COMMERCE_CHECKOUT_TOKEN` and
   `{ order, amount, currency, email, name, return_url, cancel_url, callback_url }`.
   The provider answers `{ "url": "https://..." }`, its hosted payment page.
2. Once the money is taken, the provider sends `POST <callback_url>`
   (`https://commerce.<domain>/api/store/payments`) with the same bearer token and
   `{ order, amount, ref }`. Commerce records each `ref` once and marks the order paid.

## Stock API for other apps

Operations (production and maintenance) keeps no stock of its own. It calls Commerce with
`Authorization: Bearer $COMMERCE_SVC_TOKEN`:

- `GET /api/svc/items?q=` or `?sku=A,B,C`: `[{ id, sku, name, unit, cost, onHand, byLocation: [{ locationId, onHand }] }]`.
- `GET /api/svc/locations`: `[{ id, name, kind }]`.
- `POST /api/svc/stock-moves` with `{ reference, sku, locationId?, qty, unitCost?, kind, account?, note? }`.
  - `kind` is `mfg_issue` or `maint_issue` (parts used, negative `qty`, valued at average cost) or
    `mfg_receipt` (product made, positive `qty`, at `unitCost`, which moves the average).
  - The value posts to Books against `account`, such as work in progress. By default that is the
    stock adjustment account.
  - `locationId` defaults to the first location.
  - It answers `{ onHand, unitCost }`, with `duplicate: true` when the `reference` was already
    recorded. It answers 409 when there isn't enough on hand.

## Why not Medusa

Medusa was the candidate engine for the store. Commerce keeps its own store instead so the
register, the back office and the web share one catalog and one stock ledger with no syncing
between two databases, and so everything posts to Books the same way.

## Development

```sh
npm run dev --workspace apps/commerce     # http://localhost:3730
TEST_DATABASE_URL=postgres://... npm test --workspace apps/commerce
```
