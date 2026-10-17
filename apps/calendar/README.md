# Calendar (Outlook Calendar equivalent)

The suite's calendar: day, week, month and agenda views with a mini month, personal and company calendars, all-day events, attendees, repeating events, a free/busy API that the booking page and other apps use, and CalDAV so phones and desktop calendar apps sync with it.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3130)
- **Web:** React 18 + Vite, `web/`
- **Who sees what:** your own events, everything on the company calendar, and events you're invited to. Only the owner can edit an event.
- **Repeating events** follow RFC 5545 rules (daily, weekly on chosen days, monthly by date or by "second Tuesday" or "last Friday", yearly, every N, until a date or N times), expanded with [rrule-temporal](https://github.com/ggaabe/rrule-temporal) (MIT) in the event's own time zone, so a 9:00 meeting stays at 9:00 across daylight saving changes. One occurrence can be skipped or changed on its own; editing or deleting asks whether it is this event, this and following, or all events. Free/busy, Bookings' free-time lookups, invitations, suite search and the compliance search all see each occurrence.
- **Phone sync (CalDAV):** see [Phone and desktop sync](../../deploy/README.md#phone-and-desktop-sync-caldav-and-carddav). Code in `server/dav.js` (collections), `server/ical.js` (iCalendar mapping) and `packages/dav` (the protocol, shared with Contacts).

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name calendar-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/calendar/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm start                                        # http://localhost:3130
```

The tables are created on first start. Add `?as=other@example.com` to the URL to act as a second user. For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5230, proxies `/api` to 3130).

## API

Signed-in routes are under `/api`: `GET/POST /api/events`, `PATCH/DELETE /api/events/:id` and `GET /api/freebusy?email=`. `GET /api/events?from=&to=` returns each occurrence of a repeating event in the range (spans up to three years), carrying the series id, `occurrence` (its original start) and `recurring: true`. An event takes `rrule` (an RFC 5545 rule such as `FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10`), `tzid` (an IANA time zone) and `allDay`; `PATCH` and `DELETE` on a repeating event take `scope` (`this`, `following` or `all`) and `occurrence`. Machine consumers such as Bookings use `/api/svc/freebusy`, `POST /api/svc/events`, and `PATCH`/`DELETE /api/svc/events/:id` with `Authorization: Bearer $CAL_SVC_TOKEN`. A service may move or remove only events it added: the request names the organizer (`ownerEmail`) and the `source` the event was added with; the gateway lets `/api/svc/` through without a sign-in.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port to listen on (default 3130). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `CAL_SVC_TOKEN` | Bearer token for the `/api/svc/` service routes. When unset, those routes refuse every request. |
| `AUTH_INTERNAL_URL` | Where CalDAV checks app passwords (default `http://auth:3500`), with `PROXY_SHARED_SECRET`. Without the secret, CalDAV sign-in is off. |

## Tests

`npm test` runs the unit tests and, with `TEST_DATABASE_URL` set, the API, recurrence and CalDAV tests against Postgres. Two end-to-end checks run against a started server: `npm run test:e2e` (the month view and repeating events in Chromium, see `e2e/month.e2e.mjs`) and `e2e/dav_clients.py` (python-caldav and vdirsyncer syncing calendars and contacts both ways; setup in the file).

## Production

Deployed with the rest of the suite as the `calendar` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
