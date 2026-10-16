# Synergy Books

Double-entry accounting for small businesses: the suite's answer to QuickBooks
and Dynamics 365 Business Central. Every invoice, bill, payment and bank
transaction posts a balanced journal entry, and the reports read those entries.

## What it does

- **Ledger**: chart of accounts (a standard one is created with each company),
  journal entries with reversal, fiscal periods and close, classes and locations,
  multi-currency, budgets.
- **Sales**: customers, estimates, invoices, credit memos, recurring invoices,
  statements, a customer portal (`/api/portal/*`, signed links, no suite sign-in
  needed) and online payments through Stripe or Square.
- **Purchases**: vendors, bills, vendor credits, purchase orders with receiving,
  expenses, 1099 tracking, check printing.
- **Banking**: bank accounts, statement import, reconciliation, rules and
  AI-assisted categorization, card transactions.
- **Payroll and time**: employees, pay runs, timesheets, EFTPS deposit files.
- **Inventory**: items, bundles, stock on hand.
- **Fixed assets**: depreciation schedules.
- **Sales tax**: rates, liabilities and filing.
- **Reports**: profit and loss, balance sheet, trial balance, cash flow, A/R and
  A/P aging, exported as CSV or PDF.
- **Budgets and forecasts**: plans by account and month, quarter or year (typed in,
  spread from an annual amount, or started from last year's actuals plus a percent),
  optionally for one class or location; budget vs actual straight from posted
  journals with favorable and unfavorable variance; rolling forecasts that keep
  actuals for closed periods and project the rest by run rate, trend or the plan.
- **Multi-company and consolidation**: an admin can add companies, each with its own
  currency and chart of accounts, and give people access with a role per company;
  the company menu switches between them. Intercompany charges, loans and
  settlements post a journal in both companies at once (through 1450 Intercompany
  Receivable and 2450 Intercompany Payable). A consolidation group reports its
  companies in one currency, with a column per company, the eliminations and the
  group total; balance sheets translate at the closing rate, income at the period's
  average rate, and the difference shows as the currency translation adjustment.
- **AI**: categorization, tax classification and a tax advisor run on the suite's
  shared model setting (`AI_*`, or `BOOKS_AI_*` to give Books its own model), so
  any OpenAI-compatible server or Anthropic works. Without a model these features
  are off and everything else still works.

## How it fits the suite

- Sign-in is the suite's. The gateway passes the signed-in user; Books creates
  their user record on first visit. The first person in gets the company
  (named by `BOOKS_COMPANY_NAME`) as an admin; later people join it as users.
- One server: NestJS serves the API under `/api` and the built web app at the
  same origin, on the suite port for `books` (3055).
- Other suite apps reach Books over `/api/svc/*` with `Authorization: Bearer
  BOOKS_SVC_TOKEN`: the Portal add-on reads a client's invoices
  (`GET /api/svc/invoices?email=`), and Projects creates draft invoices from
  approved time and expenses (`POST /api/svc/invoices`). Drafts go to
  `BOOKS_SVC_ORG_ID`, else the oldest company, and post to the ledger when sent.
- Background jobs (invoice email, recurring invoices) use Bull, which needs Redis.
  `deploy/compose.yml` runs one.

## Run it locally

```sh
npm ci && npm run build:packages
createdb books
export DATABASE_URL=postgres://localhost/books DEV_USER_EMAIL=you@example.com
npm run db:migrate -w @synergy/books-api
npm run db:seed -w @synergy/books-api   # optional demo company for BOOKS_SEED_EMAIL
npm run dev -w @synergy/books-api       # API on :3055
npm run dev -w @synergy/books-web       # web on Vite, proxying /api to :3055
```

## Settings

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres database |
| `REDIS_HOST`, `REDIS_PORT` | Redis for background jobs (default localhost:6379) |
| `ENCRYPTION_KEY` | 64 hex characters; encrypts stored bank and EFTPS credentials (`BOOKS_ENCRYPTION_KEY` in `deploy/.env`) |
| `BOOKS_COMPANY_NAME` | Name of the company created for the first user |
| `EMAIL_FROM` | Sender for invoices and statements (`BOOKS_EMAIL_FROM` in `deploy/.env`) |
| `PLAID_*`, `YODLEE_*` | Bank linking through Plaid or Yodlee, if you use them |

Stripe and Square keys for invoice payments are entered per company in the app's settings.

## Not done yet

- Consolidation assumes every company is fully owned: there is no minority interest
  yet, and equity translates at the closing rate rather than historical rates.
- Exchange rates are entered by hand on the Consolidation page; there is no rate feed.

- Live bank feeds through Stripe Financial Connections need a separate payments
  service (`PAY_SERVICE_URL`, `PAY_SERVICE_TOKEN`) that is not part of this repo yet.
- The tax advisor answers from the model alone; the tax-code reference corpus it
  was built around is not included.
- Several older modules still use loose types (`as any`) around Prisma results.
