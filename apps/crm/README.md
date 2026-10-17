# CRM (Dynamics 365 Sales equivalent)

Accounts, contacts, leads with conversion, an opportunity pipeline with a weighted forecast, activities and My Day, AI lead scoring on your own model and web-to-lead.

- **App:** Next.js 16 + React 19 + Postgres (port 3095).
- **Who sees what:** everyone is signed in by the suite gateway (`@synergy/identity`). The first person in becomes admin, everyone after is a rep. Reps see their own records, records shared with them and what hangs off those, or every record if an admin says so (`lib/access.ts`); only owners and managers change a record.
- **Accounts** have a type (prospect, customer, partner, competitor, other), an industry, an address with city, state and ZIP, an optional map position, and **details**: facts with no field of their own, such as what an import brought, shown as a list on the account page. The list filters by type, industry and state, searches name, industry, website, phone and address, and comes 1,000 at a time ("Show more"), so it stays quick with hundreds of thousands of accounts.

## Importing from SynergyRoutes

The older SynergyRoutes app's CRM side (about 160,000 healthcare accounts from CMS and other public registries, each with its main phone line as a contact, plus its opportunities and activities) comes across with `deploy/hub-import/run.sh routes` (see `deploy/README.md`). Open the CRM once first: the first person in becomes its admin, and anything without an owner goes to them.

```bash
deploy/hub-import/run.sh routes root@old-server --dry-run --map-email shane@old.example=shane@new.example
deploy/hub-import/run.sh routes root@old-server --map-email shane@old.example=shane@new.example
```

- The entity type (Pharmacy, Hospice, Hospital, ...) becomes the industry, the address and position come across, and visit priority, visit frequency, last visit, next action date and every registry fact (ratings, certified beds, ownership, license, ...) go to the account's details.
- Contacts are owned by their account's owner and give an account with no phone its number.
- Owners and assignees are matched by email (`--map-email old=new`, repeatable); anyone not yet in the CRM is added as a rep. `--owner <email>` picks who gets unowned records (default: the longest-standing admin).
- Records keep their SynergyRoutes ids, so running it again updates them instead of adding them twice. A re-run puts the old app's values back over changes to the same fields here, except an account's type, website and phone.
- Territories, routes and route stops are route planning and stay behind.

It writes 1,000 rows per transaction. 163,000 accounts and 163,000 contacts take about 30 seconds on a laptop's Postgres; a re-run that changes nothing about 12. To try it without the old server, `node test/fixtures/synthetic-routes.mjs | node scripts/import-hub.mjs` imports a synthetic export of the same size.

## Run it locally

You need Node 22 and Postgres.

```
npm install && npm run build:packages            # from the repository root
cd apps/crm
export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/crm
export DEV_USER_EMAIL=you@example.com
npm run dev                                      # http://localhost:3095
```

Tables are created and updated on first use (`lib/db.ts`). `npm test` runs the unit tests, and the database tests (the importer's among them) when `TEST_DATABASE_URL` is set.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL`, `CRM_DATABASE_URL` | Postgres connection string; `CRM_DATABASE_URL` wins, for a host shared with apps that read `DATABASE_URL`. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `CRM_API_TOKEN` | Bearer token for web-to-lead (`POST /api/intake/lead`); unset turns the endpoint off. |
| `CRM_INTAKE_OWNER` | Who owns web leads (default: the longest-standing admin). |
| `CRM_AI_PROVIDER`, `CRM_AI_BASE_URL`, `CRM_AI_API_KEY`, `CRM_AI_MODEL` | The model for lead scoring (`@synergy/ai`). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
