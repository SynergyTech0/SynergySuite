# People add-on (HR records and PTO)

A small HR app for the suite: an employee directory, each person's manager, start date and emergency contact, and paid time off. Everyone can see the directory and request time off; admins add and edit employees and approve or deny requests. Vacation days are counted as business days (Monday to Friday) against each employee's yearly allowance.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3140); the business-day count is in `server/days.js`
- **Web:** React 18 + Vite, `web/`
- **Who sees what:** non-admins see name, title, manager and status in the directory, plus their own requests; admins see full records and every request.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name people-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd addons/people/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com ADMIN_EMAILS=you@example.com
npm start                                        # http://localhost:3140
```

The tables are created on first start. Add `?as=other@example.com` to the URL to act as a non-admin. For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5240, proxies `/api` to 3140).

`npm test` runs the unit tests.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `ADMIN_EMAILS` | Comma-separated emails that can add and edit employees and decide PTO requests. With none set, nobody can. |
| `PORT` | Port to listen on (default 3140). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |

## Production

Deployed with the rest of the suite as the `people` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
