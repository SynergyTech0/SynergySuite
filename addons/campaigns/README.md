# Campaigns (Dynamics 365 Marketing and Mailchimp equivalent)

Email marketing for the suite. Marketers build audiences from CRM, Contacts, spreadsheets and a signup form, design emails from blocks, and send campaigns now or on a schedule. Every send is tracked: opens, clicks per link, unsubscribes, bounces and spam reports. Automations send a welcome email, or any email, a while after someone joins or gets a tag.

- **App:** Next.js 16 + React 19 + Postgres (port 3400). Mail goes out with Nodemailer; bounces are read with ImapFlow.
- **Who sees what:** staff are signed in by the suite gateway (`@synergy/identity`). The first person to open Campaigns is its admin; everyone after starts as a viewer. Viewers see lists and reports, marketers also edit lists and send, admins also change the sender settings and roles. Recipients never sign in: tracking, unsubscribe, the browser copy and the signup form work from links with a secret token of their own.
- **Built on the suite's mail server.** By default Campaigns sends as its From mailbox through Stalwart, the way Bookings does, creating the mailbox if need be, and reads bounces from that mailbox. Any SMTP relay (Amazon SES, Postmark, Mailgun, your provider) works instead. This add-on grew out of an older prototype that handed sending to a separate mailer; that mailer is no longer needed.

## How it fits with the other apps

| App | What Campaigns does with it |
|---|---|
| CRM | Imports contacts (`/api/contacts`) or leads (`/api/leads`) as the person doing it, so CRM's own sharing rules decide who they can see. With "keep in sync", the list is pulled again before each campaign goes out. |
| Contacts | Imports a contact group (`/api/contacts?group=…`), also as the person, also optionally kept in sync. |
| Mail (Stalwart) | Sends as the From mailbox with the master login Mail uses, and reads bounce and spam reports from it over IMAP. |
| Search, Admin | Campaigns, templates and audiences answer suite search (`POST /api/search`). Campaigns and templates answer the Admin center's eDiscovery (`/api/compliance/*`); one deleted while anyone is on legal hold is kept for the hold. |
| AI | Suggests subject lines on the suite's own model (`@synergy/ai`), when one is set. |

## Sending

Starting a campaign freezes its email and makes one delivery per subscribed person in its audience or segment, skipping anyone on the do-not-email list. A background queue in each instance sends them at the per-minute rate set in Settings, retries temporary failures with growing waits (at most five tries), and treats a permanent refusal (a 5xx at the recipient) as a hard bounce. Several instances can share one database: deliveries are claimed with row locks. Campaigns can be paused, resumed and cancelled while they send.

Every email carries the organization's name and postal address, an unsubscribe link, and `List-Unsubscribe` with `List-Unsubscribe-Post` for the one-click unsubscribe Gmail and Yahoo require (RFC 8058). Campaigns won't send until the From address, organization and postal address are filled in. For inbox placement, publish SPF, DKIM and DMARC records for the From domain.

Links are rewritten to `/t/c/<token>/<n>`, which only redirects to that email's own links, so the tracker can't be used as an open redirect. Opens come from a pixel at `/t/o/<token>`, so they are approximate; clicks are exact.

## Lists and consent

Each address appears once per audience. A person who unsubscribes stays unsubscribed: imports and syncs never resubscribe them. "Unsubscribe from everything", a hard bounce or a spam report puts the address on the suite-wide do-not-email list, which every audience respects. The signup form asks for consent, records when and from where it was given, uses double opt-in by default, has a honeypot field and is rate limited.

Segments match people by email, name, company, tag, custom field, where they came from, when they joined, and whether they opened or clicked a given campaign, any campaign, or any in the last so many days, with all or any of the conditions.

## Run it locally

You need Node 22 and Postgres.

```
npm install && npm run build:packages            # from the repository root
cd addons/campaigns
export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/campaigns
export DEV_USER_EMAIL=you@example.com
npm run dev                                      # http://localhost:3400
```

Tables are created on first use. Without mail settings, everything works except sending, which Settings and the campaign editor say is off. To try sending, point `CAMPAIGNS_SMTP_*` at a test SMTP server (Mailpit, for example) with `CAMPAIGNS_SMTP_TLS=off`.

`npm test` runs the unit tests, and the database tests when `TEST_DATABASE_URL` is set.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` (or `CAMPAIGNS_DATABASE_URL`) | Postgres connection string. |
| `DEV_USER_EMAIL` | Signs every staff request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `SUITE_DOMAIN`, `MAIL_DOMAIN` | The suite's domain, and its mail domain if different. The From address defaults to `marketing@` the mail domain. |
| `CAMPAIGNS_PUBLIC_URL` | Where recipients open tracking, unsubscribe and signup links (default `https://campaigns.<SUITE_DOMAIN>`). |
| `CAMPAIGNS_FROM_EMAIL`, `CAMPAIGNS_FROM_NAME`, `CAMPAIGNS_ORG_NAME`, `CAMPAIGNS_POSTAL_ADDRESS`, `CAMPAIGNS_PER_MINUTE` | Defaults for the sender settings, which admins can change in the app. The rate defaults to 60 emails a minute. |
| `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_MASTER_USER`, `MAIL_MASTER_PASSWORD`, `MAIL_SUITE_TLS_INSECURE` | Send as the From mailbox through Stalwart, with the master login Mail uses. Compose sets these. |
| `MAIL_ADMIN_URL`, `MAIL_ADMIN_USER`, `MAIL_ADMIN_PASSWORD` | Create the From mailbox on Stalwart if it doesn't exist yet. |
| `MAIL_IMAP_HOST`, `MAIL_IMAP_PORT` | Read bounces from the From mailbox on Stalwart. |
| `CAMPAIGNS_SMTP_HOST`, `CAMPAIGNS_SMTP_PORT`, `CAMPAIGNS_SMTP_USER`, `CAMPAIGNS_SMTP_PASSWORD`, `CAMPAIGNS_SMTP_TLS` | Send through an outside relay instead. Port defaults to 587; `CAMPAIGNS_SMTP_TLS=off` allows a relay without STARTTLS (for local testing). |
| `CAMPAIGNS_BOUNCE_IMAP_HOST`, `CAMPAIGNS_BOUNCE_IMAP_PORT`, `CAMPAIGNS_BOUNCE_IMAP_USER`, `CAMPAIGNS_BOUNCE_IMAP_PASSWORD` | The mailbox bounces return to when sending through an outside relay. |
| `CAMPAIGNS_BOUNCE_POLL_SECONDS` | How often to check for bounces (default 300). |
| `CRM_INTERNAL_URL`, `CONTACTS_INTERNAL_URL` | Where to reach CRM and Contacts (default `http://crm:3095` and `http://contacts:3190` in production). |
| `CAMPAIGNS_SENDER` | `off` stops this instance sending and checking bounces. |
| `CAMPAIGNS_AI_*`, `AI_*` | The AI model for subject suggestions (see `@synergy/ai`). |
| `DEMO_MODE` | `1` sends no email at all. |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
