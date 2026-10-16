# Ops (Dynamics 365 Supply Chain Management equivalent)

Manufacturing and asset management in one app.

**Manufacturing**

- **Items:** what you make and what you buy, with safety stock, reorder point, lot size and lead time, and stock on hand at average cost (mirrored from Commerce when it is linked). Stock can never go negative.
- **Bills of materials:** components with scrap allowance and a routing of operations through work centers, each with setup and run minutes. Bills are versioned: edit a draft, activate it, and the previous active bill becomes obsolete. A bill that uses itself, directly or several levels down, is refused. Costing rolls material and labor up through every level.
- **Work orders:** release copies the active bill's materials and operations; materials are issued (all at once or one by one), operation minutes are logged, and completing the order backflushes anything not yet issued and receives the finished goods at their actual cost (materials plus minutes at each work center's rate).
- **Planning (MRP):** enter demand (or let another app send it), run planning, and get dated build and buy suggestions level by level, offset by lead time, respecting safety stock, lot size and reorder point. Suggestions that should already have started are flagged late. Firm a build into a work order or a buy into a purchase request.
- **Purchase requests:** mark ordered, receive (in Commerce when it is linked, otherwise here at the price paid), or cancel.

**Assets**

- **Register:** tagged assets (AST-2026-0001) with location, parent asset, custodian, purchase cost, salvage value and useful life; straight-line book value is shown live. Assets with a meter (hours, km, cycles) take readings, which can't go backwards.
- **Preventive plans:** every so many days and/or every so much on the meter. Due work opens on its own every hour and whenever a reading crosses the threshold, never more than one open order per plan.
- **Maintenance orders:** corrective or preventive, with priority, assignee, labor minutes and spare parts drawn from stock. Starting work puts the asset in repair; finishing a plan's order moves the plan on from the date and reading it was done at.

## How it fits the suite

- **Commerce owns stock.** When `OPS_COMMERCE_URL` and `COMMERCE_SVC_TOKEN` are set, Ops copies each item's quantity on hand and average cost from the Commerce product with the same SKU (every five minutes and before each planning run), and plans against it. Materials issued to work orders, finished goods and spare parts used on maintenance are queued and sent to Commerce in order (reference `ops-move-<id>`, so a retry never moves stock twice). Commerce moves the stock and posts the journal to Books: issues and finished goods against `OPS_WIP_ACCOUNT` (default 5000), parts against `OPS_MAINTENANCE_ACCOUNT` (default 6000). Receiving and counting stock happen in Commerce; products can be imported from it. Without Commerce, Ops keeps its own small stock ledger.
- **Books:** when `OPS_BOOKS_URL` and `BOOKS_SVC_TOKEN` are set, an asset can be sent to the Books fixed-asset register, where Books depreciates it.
- **Other apps** (sales, purchasing, e-commerce) can send demand with `POST /api/svc/demand` and read buy suggestions with `GET /api/svc/purchase-requests`, both with `Authorization: Bearer $OPS_API_TOKEN`.
- **Search and compliance:** items, bills, work orders, assets and maintenance orders show up in suite search (`POST /api/search`); work orders, maintenance orders and assets a person owns or worked on come back in eDiscovery (`/api/compliance/search` and `/api/compliance/export`). Nothing is ever hard-deleted, so legal holds need no extra handling.

## Run it locally

```
npm install && npm run build:packages     # from the repository root
export OPS_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ops
npm run dev -w synergy-ops                # http://localhost:3760
```

The tables are created on first start. Tests: `TEST_DATABASE_URL=postgres://... npm test -w synergy-ops` (the pure planning maths runs without a database).

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` / `OPS_DATABASE_URL` | Postgres connection string; `OPS_DATABASE_URL` wins. |
| `OPS_API_TOKEN` | Bearer token other apps use for `/api/svc/*`. Leave empty to turn those endpoints off. |
| `OPS_COMMERCE_URL` | Commerce base URL (compose default `http://commerce:3730`). |
| `COMMERCE_SVC_TOKEN` | Commerce's service token; with `OPS_COMMERCE_URL` stock is kept in Commerce. |
| `OPS_WIP_ACCOUNT` / `OPS_MAINTENANCE_ACCOUNT` | Books accounts for the other side of issues and spare parts (defaults 5000 and 6000). |
| `OPS_BOOKS_URL` | Books API base URL (compose default `http://books:3055`). |
| `BOOKS_SVC_TOKEN` | Books' service token; with `OPS_BOOKS_URL` assets can be sent to Books. |

## Upgrading an existing install

`deploy/postgres-init.sql` only runs on a fresh database volume. On an install that already exists, create the database once before starting Ops:

```
docker compose exec postgres psql -U postgres -c "CREATE DATABASE ops"
```

## Credits

The planning engine and screens are Synergy's own TypeScript. [ERPNext](https://github.com/frappe/erpnext) (GPL-3.0) and [Odoo](https://github.com/odoo/odoo) (LGPL-3.0) manufacturing and maintenance modules were used as design references for the concepts (bills of materials, routings, work orders, preventive plans); no code was copied from either.
