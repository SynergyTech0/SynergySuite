# Notes (OneNote equivalent)

Wiki-style notes for the suite: spaces, a page tree you can drag pages around in, Markdown pages with live co-editing, labels, templates, comments, attachments, version history, page restrictions and trash, plus Word and PDF export.

- **Server:** Node 22 + Express + Postgres, `server/index.js` (port 3135)
- **Live co-editing:** a separate [Hocuspocus](https://tiptap.dev/docs/hocuspocus) (Yjs) server, `server/collab.mjs` (port 3136). It saves the shared document back to the same database and records who made each version.
- **Web:** React 18 + Vite + CodeMirror, `web/`
- **Auth:** the suite gateway signs people in; `@synergy/identity` reads the signed-in user from its headers.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name notes-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/notes/web && npm install && npm run build && cd ..

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
npm start                                        # http://localhost:3135
npm run collab                                   # in a second terminal
```

The tables are created on first start, along with a "General" space.

Without the gateway, the browser can't reach the collab server through `/collab`, so open a page with `?collab=ws://localhost:3136` added to the URL to edit live. Without the collab server, pages still open and save normally; you just don't see other people's cursors. Add `?as=other@example.com` to act as a second user.

For the Vite dev server with hot reload, run `npm run dev` in `web/` (port 5235, proxies `/api` to 3135).

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Both processes need the same one. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there's no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port for the main server (default 3135). |
| `COLLAB_PORT` | Port for the collab server (default 3136). |
| `COLLAB_ADDRESS` | Address the collab server listens on (default `127.0.0.1`; the Docker deploy uses `0.0.0.0` so the gateway can reach it). |
| `SPACE_ADMINS` | Comma-separated emails that can manage every space, including restricted ones. |
| `DOCX2PDF_URL` | Full URL of a document-to-PDF converter for "Export as PDF", such as Gotenberg's `/forms/libreoffice/convert`. When unset, PDF export falls back to the browser's print dialog. |
| `DOCX2PDF_TOKEN` | Optional bearer token sent to `DOCX2PDF_URL`. |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |

## Production

Deployed with the rest of the suite as the `notes` and `notes-collab` services in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
