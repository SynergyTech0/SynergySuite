# Calendar (Outlook Calendar equivalent)

The suite's calendar: a week view with personal and company calendars, all-day events, attendees, and a free/busy API that the booking page and other apps use.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3130)
- **Web:** React 18 + Vite, `web/`
- **Who sees what:** your own events, everything on the company calendar, and events you're invited to. Only the owner can edit an event.

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

Signed-in routes are under `/api`: `GET/POST /api/events`, `PATCH/DELETE /api/events/:id` and `GET /api/freebusy?email=`. Machine consumers such as Bookings use `/api/svc/freebusy`, `POST /api/svc/events`, and `PATCH`/`DELETE /api/svc/events/:id` with `Authorization: Bearer $CAL_SVC_TOKEN`. A service may move or remove only events it added: the request names the organizer (`ownerEmail`) and the `source` the event was added with; the gateway lets `/api/svc/` through without a sign-in.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port to listen on (default 3130). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `CAL_SVC_TOKEN` | Bearer token for the `/api/svc/` service routes. When unset, those routes refuse every request. |

## Production

Deployed with the rest of the suite as the `calendar` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
