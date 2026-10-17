# Synergy CRM

Sales for the suite, its answer to Dynamics 365 Sales: accounts, contacts, leads, the opportunity pipeline and the activity around them.

- **Records.** Accounts with their contacts and opportunities; leads that convert into an account, a contact and maybe a deal in one step (a converted lead is read-only). Tasks, events, calls and notes on any record, and My Day for what is assigned to you.
- **Pipeline.** A board of opportunities by stage with a weighted forecast; a move resets the deal's probability to the stage default.
- **Accounts.** They have a type (prospect, customer, partner, competitor, other), an industry, an address with city, state and ZIP, an optional map position, and **details**: facts with no field of their own, such as what an import brought, shown as a list on the account page. The list filters by type, industry and state, searches name, industry, website, phone and address, and comes 1,000 at a time ("Show more"), so it stays quick with hundreds of thousands of accounts.
- **Referral partners and referrals.** A partner is a person or company that sends business, optionally the same as a contact or account already in the CRM, with contact details, active or inactive, and a default reward: a fixed amount or a percentage of the won deal. A lead or opportunity records who referred it ("Referred by" in its editor); converting the lead carries the referral onto the new deal. Each referral copies the partner's default reward when it is made, so later changes to the default don't rewrite it. **Referrals** lists them with their stage (new, qualified, won, lost: from the deal once there is one, else the lead), deal value, reward, and what is owed or paid; the partner's owner or a manager marks a won reward paid with a date, amount and note (and can undo it). A partner's page shows their referrals and totals: sent, won, earned, paid, outstanding. Once a reward is paid, who referred the deal can't change and the partner can't be deleted (set them inactive instead). Both lists export as CSV.
- **Roles and access.** Admin, manager or rep (the first person in is admin). Reps edit what they own; managers and admins edit and reassign everything. What reps see is an admin setting: their own and shared records (the default), or everything. A partner comes with the referrals it sent, and a rep who can see a referred lead or deal sees its partner and that referral, though not the partner's other referrals. Sharing works on accounts, contacts, leads, opportunities and partners.
- **AI lead scoring** on the suite's own model (`@synergy/ai`; `CRM_AI_*` to give the CRM its own). A score set by hand sticks until it is cleared.
- **Web-to-lead.** A website's server posts to `POST /api/intake/lead` with `Authorization: Bearer <CRM_API_TOKEN>` (JSON or a form post: name, email or phone, company, message, `utm_*`, landing path). With the token unset the endpoint answers 404. New leads go to `CRM_INTAKE_OWNER`, else the longest-standing admin. A `partnerCode` (or `partner_code`, or `ref`) naming an active partner's code makes the lead a referral from that partner with source Referral; unknown or inactive codes are ignored, and the answer is the same either way.
- **Suite search** (`POST /api/search`, per person, by the same access rules) and **eDiscovery** (`/api/compliance/search|export`) cover accounts, contacts, leads, opportunities, partners and activities; a lead or deal is also found by the name of the partner that referred it. Deletes under a legal hold are kept, hidden.

Port 3095, database `crm` (`CRM_DATABASE_URL`, else `DATABASE_URL`). The schema is applied on start and upgrades older installs in place. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/crm`.

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
