# Portal add-on (customer portal)

A private page for each client. Staff create a client record with a welcome message, and the client gets a link (`/c/<token>`) to a page showing their open invoices, amount outstanding and support tickets, with no account or sign-in. Staff can preview what a client sees, switch a client off, or rotate the link.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3155)
- **Web:** React 18 + Vite, `web/` (the staff console)
- **Data:** invoices and tickets come from separate invoicing and help desk services over token-protected `/api/svc/` endpoints. Either one can be missing or down; the portal then shows that section empty instead of failing.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name portal-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd addons/portal/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm start                                        # http://localhost:3155
```

The tables are created on first start. Add `?as=other@example.com` to the URL to act as another staff member. For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5255, proxies `/api` to 3155).

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `ALLOWED_EMAILS` | Comma-separated emails allowed into the staff console. When unset, any signed-in user can use it. |
| `INVOICE_SVC_URL` / `INVOICE_SVC_TOKEN` | Where client invoices come from; the portal reads `<url>/api/svc/invoices?email=`. In the suite this is Books (`http://books:3055`, token `BOOKS_SVC_TOKEN`), which compose sets for you. |
| `DESK_SVC_URL` / `DESK_SVC_TOKEN` | Where client tickets come from; the portal reads `<url>/api/svc/tickets?email=`. In the suite this is Desk (`http://desk:3105`, token `DESK_API_TOKEN`), which compose sets for you. |
| `PORT` | Port to listen on (default 3155). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |

## Production

Deployed with the rest of the suite as the `portal` service in `deploy/compose.yml`; the gateway lets `/c/` through without a sign-in. See [deploy/README.md](../../deploy/README.md).
