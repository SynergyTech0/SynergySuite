# SynergyMail

A self-hosted, Mailchimp-style marketing email platform.

- **Front end / control plane:** Next.js 15 (App Router, TypeScript) — dashboard, audiences,
  block email builder, campaigns with open/click tracking, scheduling, automations.
- **Storage:** SynergyDB (Postgres wire, `DATABASE_URL`, default port 5499).
- **Delivery worker:** the Python SMTP mailer at `C:\Users\shane\email-mailer` — reused as-is.
  SynergyMail composes each campaign, writes the mailer's config/CSV/template, and drives it.

## Features (all verified end-to-end)

| Pillar | What's included |
|---|---|
| **Audiences & contacts** | Create audiences, single add, CSV import (validation + dedupe), per-contact subscribe/unsubscribe |
| **Email builder + templates** | Block editor (heading/text/button/image/divider), `{{ merge \|default: … }}` tags, live preview |
| **Campaigns + tracking** | Create from template+audience, dry-run, send, open + click tracking, per-campaign stats dashboard |
| **Scheduling & automation** | Schedule a send for later; welcome-style automation on contact-added; both fire via the scheduler tick |

## Run it

```powershell
cd C:\Users\shane\synergymail
copy .env.local.example .env.local     # then edit — SEE BELOW
npm run dev                            # http://localhost:3400
```

### Configure `.env.local`

1. **`DATABASE_URL`** — SynergyDB (default `postgres://postgres:postgres@127.0.0.1:5499/synergydb`).
   The schema is created automatically on first use.
2. **SMTP** — `MAILER_SMTP_*`. Put the password in `MAILER_SMTP_PASSWORD`.
   > The shipped `.env.local` points SMTP at a **local test sink** (`127.0.0.1:8025`, security `none`)
   > so nothing is actually emailed. **Switch these to a real SMTP host before sending for real.**
3. **`PUBLIC_BASE_URL`** — must be reachable by recipients' mail clients for open/click tracking to
   register. `http://localhost:3400` works for local testing; use your public host for a real send.
4. **CAN-SPAM** — `MAILER_ORG_NAME` and `MAILER_POSTAL_ADDRESS` are appended to every email
   (legally required). The mailer also adds one-click `List-Unsubscribe` headers pointing at
   `/u/{campaignId}`.

## Scheduling

Scheduled campaigns and automation emails fire when the scheduler endpoint is hit:

```
GET /api/cron?secret=<CRON_SECRET>
```

Wire it to a Windows Scheduled Task (like your social scheduler) to run every minute:

```powershell
schtasks /Create /SC MINUTE /MO 1 /TN "SynergyMail\Cron" ^
  /TR "curl.exe -s http://localhost:3400/api/cron?secret=dev-secret"
```

## How tracking works

Each contact gets a random `token`. On send, the campaign HTML is rewritten so:
- links become `/t/c/{cid}/{{track_token}}?u=<original>` (click → record + 302 redirect),
- a 1×1 pixel `/t/o/{cid}/{{track_token}}` is appended (open → record).

The Python mailer fills `{{track_token}}` per recipient. Events land in the `events` table;
the campaign page shows sends / unique opens / unique clicks / unsubscribes.

## SynergyDB compatibility notes

SynergyDB 0.1.0 has wire quirks the data layer (`lib/db.ts`) works around — **read the header
comment there before adding queries.** In short: use `BIGINT` (not `INT`), store timestamps as
epoch-ms `BIGINT`, lists as `JSONB`, avoid `SELECT DISTINCT` and `GROUP BY` aggregates, don't cast
the `LIMIT` parameter, and cast every other parameter to its column type.

## Layout

```
lib/db.ts        SynergyDB pool, schema, quirk rulebook
lib/repo.ts      typed data access (all the ::casts live here)
lib/render.ts    blocks -> HTML, tracking injection
lib/send.ts      bridge to the Python mailer (campaigns + one-off automation sends)
app/api/*        REST routes
app/t, app/u     tracking pixel / click redirect / unsubscribe
app/*            dashboard, audiences, templates, campaigns, automations UI
```
