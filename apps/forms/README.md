# Forms (Microsoft Forms equivalent)

Build a form, publish it at a public link, and collect responses. Fields can be short text, long text, email, a drop-down or a checkbox, each optionally required. Responses can be read in the app or downloaded as CSV.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3110)
- **Web:** React 18 + Vite, `web/` (the form builder and responses)
- **Sharing:** a form belongs to whoever made it. The owner can share it with people (or with everyone in the organization) as editors, who can change it and read its responses, or viewers, who can only read them. Everyone else can't find it, in Forms or in suite search. Forms made before sharing existed start shared with everyone as editors.
- **Public pages:** `GET /f/:slug` renders a published form as plain HTML and `POST /f/:slug` stores a response. The gateway lets `/f/` through without a sign-in, and a hidden honeypot field turns away simple bots. Sites embeds these pages with its form block.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name forms-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/forms/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm start                                        # http://localhost:3110
```

The tables are created on first start. Add `?as=other@example.com` to the URL to act as a second user. For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5210, proxies `/api` to 3110).

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port to listen on (default 3110). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |

## Production

Deployed with the rest of the suite as the `forms` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
