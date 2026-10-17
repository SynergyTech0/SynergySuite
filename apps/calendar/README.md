# Calendar (Outlook Calendar equivalent)

The suite's calendar: a week view with personal and company calendars, all-day events, attendees, and a free/busy API that the booking page and other apps use.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3130)
- **Web:** React 18 + Vite, `web/`
- **Who sees what:** your own events, everything on the company calendar, events you're invited to, and events on the group calendars you're a member of. Only the organizer can edit or delete an event, except that an owner of a group calendar may also edit or delete any event on it (only the organizer can move an event to another calendar). Group calendar membership comes from the Groups app.

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

Group calendars: `GET /api/calendars` lists the calendars the signed-in person can add events to (`personal`, `company`, and `group:<source>` entries with `source`, `name` and `role`). `POST /api/events` and `PATCH /api/events/:id` take `calendar: "group"` with `groupSource`; anyone who isn't a member of that group calendar gets 403. The Groups app keeps group calendars in step with the same Bearer token:

- `PUT /api/svc/group-calendars/:source` with `{ name, members: [{ email, role: "owner"|"member" }] }` creates or renames the calendar and makes its member list exactly that list. Returns `{ source, url }`.
- `GET /api/svc/group-calendars/:source/events?from&to` returns `{ events }` (same rows as `/api/events`), or 404 if there's no such calendar.
- `DELETE /api/svc/group-calendars/:source` removes the calendar and its members. The events are kept (their organizers still see them, and compliance search finds them), but members no longer do.
- `POST /api/svc/events` also takes `calendar: "group"` with `groupSource`; `ownerEmail` must be a member.

`source` is always `groups:<group uuid>`.

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
