# Sites (SharePoint equivalent)

A block-based page builder for team sites and landing pages. Each site has a theme and pages made of blocks (hero, heading, text, image, call to action, columns, embedded form, booking page, embed, footer), and published pages are served as plain HTML at `/s/:site` and `/s/:site/:page`. Staff can preview unpublished pages.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3170); `server/render.js` turns blocks into HTML for both the public pages and the preview
- **Web:** React 18 + Vite, `web/` (the editor)

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name sites-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/sites/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm start                                        # http://localhost:3170
```

The tables are created on first start. Add `?as=other@example.com` to the URL to act as a second user. For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5270, proxies `/api` to 3170).

`npm test` runs the renderer's unit tests.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port to listen on (default 3170). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `SUITE_DOMAIN` | The suite's domain. Form blocks embed `https://forms.<domain>/f/<slug>`; without it they use the local forms port. |
| `SITES_BOOKING_URL` | Base URL of the Bookings app (compose sets `https://bookings.<domain>`). A Booking block embeds `<url>/book/<page>` or `<url>/book/<page>/<service>`, using the block's owner and slug fields, and is left out when this is unset. |
| `SITES_LIVECHAT_URL` | Base URL of a live chat widget server. Sites with a live chat key load `<url>/widget.js`; nothing loads when this is unset. |

## Production

Deployed with the rest of the suite as the `sites` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
