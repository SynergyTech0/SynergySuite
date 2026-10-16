# Synergy Trust

Compliance readiness for **SOC 2, ISO 27001, HIPAA and GDPR**: the suite's equivalent of
Microsoft Purview Compliance Manager. It keeps a control library mapped across all four
frameworks, collects evidence automatically on a schedule, keeps that evidence and every
change in append-only, hash-chained records, and can publish an opt-in public trust centre.

It runs at `https://trust.<SUITE_DOMAIN>` (port **3670** locally) behind the suite sign-in.

## What it does

- **Frameworks and scope.** SOC 2 (Trust Services Criteria), ISO/IEC 27001:2022, HIPAA
  (45 CFR 164) and GDPR: 272 requirements in `db/catalog/`. An organisation adopts a
  framework and selects which optional categories are in scope; percentages only count what
  is in scope.
- **One control, many frameworks.** 36 control templates with 274 graded mappings
  (`full` / `partial` / `supporting`), so "MFA on admin access" answers SOC 2 CC6.1, ISO
  A.8.5, HIPAA 164.312(d) and contributes to GDPR Art. 32 at once.
- **Two readiness numbers.** *Implemented* is what the control owner says; *audit ready*
  additionally needs evidence collected in the last 90 days, which is what a Type II
  opinion tests.
- **Evidence collectors.** TLS endpoints, HTTP security headers, port exposure, dependency
  advisories against a severity SLA, backup coverage and integrity, restore drills, SSH
  hardening, patch currency, capacity headroom, asset inventory, and the integrity of
  Trust's own audit log. A collector that could not measure records `error`, never `pass`
  or `fail`, and an empty population is never a pass.
- **Collector agent** (`agent/`). Runs on a monitored host, collects locally and posts
  results outbound with its own token, so the server needs no inbound SSH and holds no keys.
  It may only report against monitors assigned to it, and cannot backdate results.
- **Append-only records.** `evidence`, `monitor_runs`, `policy_versions`, `audit_events`
  and `auth_events` refuse UPDATE and DELETE at the database. Corrections insert a new row.
- **Public trust centre** at `/trust/<slug>`, off by default with every section opt-in. It
  publishes aggregates (frameworks pursued, how many controls are implemented, policy
  titles, subprocessors), never which controls are outstanding, evidence, or hostnames.
  It never renders a certification badge (see `NOTICE.md`).

## How it fits the suite

**Sign-in is the suite's.** The gateway (SynergyAuth behind oauth2-proxy) signs people in
and passes their email on every request; `src/lib/session.ts` reads it with
`@synergy/identity` and `src/lib/auth.ts` finds or creates the Trust user by lower-cased
email. Trust has no passwords, second factors or sessions of its own.

- **The first suite user** to open Trust, when nobody belongs to any organisation yet, gets
  a new organisation named from `TRUST_COMPANY_NAME` (default "My Company") as its owner.
  The organisation starts with SOC 2 (Common Criteria) adopted and every control at
  `not_started`.
- **Everyone else** gets in only when an owner or admin adds their email on the Members
  page (or with `scripts/add-member.mjs`). The membership is created the next time that
  email opens Trust. Without one they see "ask an admin to add you" and no data.
- **Roles**: owner, admin, contributor, auditor, viewer. Auditor and viewer seats are
  read-only *in Postgres*: their requests run as the `strust_app_ro` role in a read-only
  transaction, not just with buttons hidden.
- **Tenant isolation is row-level security.** Requests run as `strust_app` (no BYPASSRLS)
  with `app.tenant_id` set per transaction; with no tenant set, queries return nothing.
- **Several organisations.** A person can belong to more than one; the user menu switches
  between them (remembered in a cookie, re-checked against the database on every request).
- **Access log.** `auth_events` records first arrival, the start of each visit, denied and
  suspended access, invitations claimed, organisation switches and membership changes.
- **Public paths.** In `deploy/Caddyfile`, `/trust/*` (the public trust centre) and
  `/api/agent/*` (agents, which present their own bearer token) skip the gateway;
  everything else needs a suite session.
- The suite app bar (`<synergy-app-bar>` from `@synergy/shell`) heads every signed-in page.

## Run it locally

From the repository root, with Postgres running:

```bash
npm ci && npm run build:packages
createdb trust                                   # or: psql -c "CREATE DATABASE trust"
cd apps/trust
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/trust
node scripts/migrate.mjs                         # applies db/migrations in order, once each
node scripts/seed.mjs                            # framework catalog and control library
DEV_USER_EMAIL=you@example.com npm run dev       # http://localhost:3670
```

The first request as `you@example.com` creates your organisation and makes you its owner.
`DEV_USER_EMAIL` stands in for the gateway and is ignored when `NODE_ENV=production`; in
development an `x-dev-user` header picks a different user.

To try collectors against your own machine:

```bash
TRUST_MONITOR_SSH_HOSTS=localhost TRUST_MONITOR_PUBLIC=example.com \
  node scripts/seed-monitors.mjs my-company     # your organisation's slug
node scripts/collect.mjs                        # runs every enabled monitor, all organisations
```

In the Docker deployment the `trust` service applies migrations and the catalog on every
start. Run collection on a schedule from the host, e.g. hourly:
`docker compose -f deploy/compose.yml exec -T trust node scripts/collect.mjs --due`.

## Settings

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection. The role connecting owns the schema; the migrations create `strust_app` and `strust_app_ro`, and grant them to it if it is not a superuser |
| `TRUST_COMPANY_NAME` | Name of the organisation created for the first user (default `My Company`) |
| `SUITE_DOMAIN` | Makes the app bar link to `https://<app>.SUITE_DOMAIN`, and public trust centre links use `https://trust.SUITE_DOMAIN` |
| `PROXY_SHARED_SECRET` | When set, identity headers are only believed on requests carrying the gateway's secret |
| `DEV_USER_EMAIL` | Development only: the signed-in user when no gateway is in front |
| `TRUST_MONITOR_PUBLIC`, `TRUST_MONITOR_HOSTS`, `TRUST_MONITOR_SSH_HOSTS`, `TRUST_MONITOR_BACKUP_HOST`, `TRUST_MONITOR_BACKUP_ROOT` | Targets for `scripts/seed-monitors.mjs` (comma-separated). Nothing is monitored by default |
| `STRUST_SERVER`, `STRUST_AGENT_TOKEN` | On a host running the collector agent: the Trust URL and the agent's token |

## Scripts

| Command | What it does |
|---|---|
| `node scripts/migrate.mjs` | Applies pending migrations |
| `node scripts/seed.mjs [--tenant <slug> [name]]` | Seeds the catalog; optionally provisions an example organisation |
| `node scripts/add-member.mjs <slug> <email> <role> [name] [title]` | Adds a member by email, and to the personnel register |
| `node scripts/seed-monitors.mjs <slug>` | Binds monitors to controls, from the `TRUST_MONITOR_*` settings |
| `node scripts/collect.mjs [--due] [slug] [monitor]` | Runs collectors; `--due` runs only what its schedule says is due |
| `node scripts/import-assets.mjs --hosts hosts.json <slug>` | Builds the asset inventory from your hosts over SSH (see the header for the file format) |
| `node scripts/assign-asset-owners.mjs --owner <email> <slug>` | Names accountable owners for assets |
| `node agent/build.mjs` | Builds the dependency-free agent bundle in `agent/dist` |

## Verification

Each suite prints what it observed, so a pass reads as evidence:

| Command | Checks |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm run verify` | Schema, append-only tables, hash chain, RLS, constraints (needs `seed.mjs --tenant example`) |
| `npm run verify:access` | Suite sign-in: first user becomes owner, uninvited users get nothing, invitations become memberships, read-only seats cannot write, tenants cannot read each other, public paths need no sign-in. Needs a fresh database and a running server |
| `npm run verify:api` | The JSON API against a running server: readiness, mappings, validation, monitor administration, agent security |
| `npm run verify:collectors` | Bad config refused, unreachable means `error`, empty populations are not passes, scheduling |
| `npm run verify:contrast` | WCAG AA contrast in both themes |

CI runs all of them (`.github/workflows/ci.yml`, job `trust`). The API and collector suites
probe `example.com` over the network.

## Layout

```
db/migrations/   raw SQL, applied in order; never edit one that has shipped, add a new one
db/catalog/      soc2 · iso27001 · hipaa · gdpr · controls (JSON, seeded idempotently)
src/lib/db.mjs   owner connection vs withTenant (app role, RLS applies)
src/lib/auth.ts  suite users, first-user bootstrap, memberships, adding members
src/lib/session.ts  the request's identity, organisation and role
src/lib/queries.ts  readiness computation shared by the dashboard and detail pages
src/lib/collectors/ the collectors and their registry
src/app/(app)/   signed-in pages; src/app/trust/ is the public trust centre
agent/           the collector agent
scripts/         migrate · seed · collect · verify suites · operator tools
```

The data layer and collectors stay plain `.mjs` (with `.d.mts` declarations) so the scripts
and the agent can import them under bare `node`.

## Not done yet

- **MFA coverage evidence.** Trust used to measure its own second factors for `AC-MFA`.
  Second factors now belong to the suite identity provider, and Trust cannot see them yet,
  so that collector was removed; `AC-MFA` needs manual evidence until the identity
  provider exposes enrolment state.
- **Trust centre settings UI.** The trust centre is configured through
  `PATCH /api/trust-center`; there is no settings page yet.
- **No email.** Adding a member does not notify them; tell them to open Trust.
- **Scheduling.** Collection runs when something calls `collect.mjs --due`; the Docker
  deployment does not include a scheduler.
- **Automated evidence covers about a quarter of the controls.** The rest need manual
  evidence each period, and the product says so rather than implying otherwise.
- **Policies, risks, vendors, personnel and DSAR registers** exist in the schema but have
  little UI.

## Licensing of standards text

Read `NOTICE.md` before shipping any requirement text. SOC 2 and ISO 27001 criteria are
copyrighted, so the catalog holds paraphrases and the UI labels them as such; HIPAA and
GDPR are public law. This tool measures readiness and must never render a certification
badge.
