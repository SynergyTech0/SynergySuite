# Bookings (Microsoft Bookings equivalent)

Booking pages customers use to book time with a business or a person. Staff set up services, opening hours and who offers what; customers pick a service, a person (or anyone), and a free time, and get a confirmation with a calendar invitation and, for online services, a Meet link. Customers can reschedule or cancel from the link in their email; staff see and manage every appointment on their pages.

- **App:** Next.js 16 + React 19 + Postgres (port 3150).
- **Who sees what:** customers never sign in. They see a published page's services and the names of its staff, and each appointment has a secret link of its own. Staff are signed in by the suite gateway (`@synergy/identity`). Everyone on a page sees its appointments and customers; only its admins change the page, its services and its staff.
- **Built on the suite, not on another scheduler.** Free times come from each person's suite Calendar, appointments go onto it, online appointments get a Meet room, customers land in the staff member's Contacts, and emails go out from the page's suite mailbox. We looked at Cal.com: its core is AGPL, but the code in its `ee` folders is under a commercial license, and it brings its own users, calendars, video and email. Building on the suite's own Calendar keeps one sign-in and one calendar.

## How it fits with the other apps

| App | What Bookings does with it |
|---|---|
| Calendar | Reads free/busy (`/api/svc/freebusy`) so a person's meetings block their booking times, and adds, moves and removes the appointment on their calendar (`/api/svc/events`). Needs `CAL_SVC_TOKEN`; without it Bookings only knows its own appointments. |
| Meet | Each online appointment gets its own room link, `https://meet.<domain>/room/b-…`. The staff member opens the room; the customer joins as a guest. |
| Mail (Stalwart) | Confirmations, changes, cancellations and reminders go out from the page's mailbox: its "emails come from" address, or whoever made the page. |
| Contacts | A new customer is added to the booked staff member's contacts. |
| Sites | A Booking block embeds a page (`/book/<page>`) or one service (`/book/<page>/<service>`). |
| Search, Admin | Appointments answer suite search (`POST /api/search`) and the Admin center's eDiscovery (`/api/compliance/*`). A page deleted while anyone on it is on legal hold is only hidden. |

## How times work

A page has a time zone and opening hours; each person can have their own hours instead. A service has a duration and optional free time before and after. Start times fall on the page's grid (every 30 minutes by default), at least the page's notice ahead and no more than its booking window. A time is offered for a person when the appointment and its buffers fit inside their hours and clear their other appointments and their calendar. Two customers can't take the same person's time: each booking takes a per-person lock and checks again before it is written.

Customers see times in their own time zone (they can pick another). Customers may change or cancel online until the page's notice period before the start. Staff can book for a customer outside opening hours, but not over a clash.

Reminders go out at the hours before the start each service asks for (24 by default), once each, and not when the appointment was booked after that moment.

## Run it locally

You need Node 22 and Postgres.

```
npm install && npm run build:packages            # from the repository root
cd apps/bookings
export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/bookings
export DEV_USER_EMAIL=you@example.com
npm run dev                                      # http://localhost:3150
```

Tables are created on first use. To try free/busy and calendar events, run Calendar on port 3130 with the same `CAL_SVC_TOKEN` in both. Without mail settings, appointments are booked and the emails are written to the log instead.

`npm test` runs the unit tests, and the database tests when `TEST_DATABASE_URL` is set.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. |
| `DEV_USER_EMAIL` | Signs every staff request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `SUITE_DOMAIN` | The suite's domain, for links to Bookings, Meet and Mail. |
| `BOOKINGS_PUBLIC_URL` | Where customers open booking pages (default `https://bookings.<SUITE_DOMAIN>`). |
| `CAL_SVC_TOKEN`, `CALENDAR_INTERNAL_URL` | Calendar's service token, and where to reach Calendar (default `http://calendar:3130` in production). |
| `CONTACTS_INTERNAL_URL` | Where to reach Contacts (default `http://contacts:3190` in production). |
| `MEET_PUBLIC_URL` | Base of Meet room links (default `https://meet.<SUITE_DOMAIN>`). |
| `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_MASTER_USER`, `MAIL_MASTER_PASSWORD`, `MAIL_SUITE_TLS_INSECURE` | Send as each page's suite mailbox through Stalwart, with the master login Mail uses. Compose sets these. |
| `MAIL_ADMIN_URL`, `MAIL_ADMIN_USER`, `MAIL_ADMIN_PASSWORD` | Create a page's sending mailbox on Stalwart if it doesn't exist yet, as Mail does. |
| `BOOKINGS_SMTP_HOST`, `BOOKINGS_SMTP_PORT`, `BOOKINGS_SMTP_USER`, `BOOKINGS_SMTP_PASSWORD`, `BOOKINGS_SMTP_FROM` | Send everything through one outside mailbox instead, with the page's address as Reply-To. Port defaults to 587. |
| `BOOKINGS_REMINDERS` | `off` stops this instance sending reminders. |
| `DEMO_MODE` | `1` sends no email at all. |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `COMPLIANCE_TOKEN`, `ADMIN_INTERNAL_URL` | The Admin center's eDiscovery and legal holds. |

## Production

The app is the `bookings` service in `deploy/compose.yml`, at `https://bookings.<domain>`; see [deploy/README.md](../../deploy/README.md). The gateway lets `/book/*`, `/booking/*` and `/api/public/*` through without a sign-in; everything else needs one. An existing install needs the database first: `CREATE DATABASE bookings;`.
