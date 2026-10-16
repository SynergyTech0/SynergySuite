# Loop (Microsoft Loop equivalent)

Shared workspaces for a team's plans and notes, made of pages and **live components**. A component (a task list, checklist, table, voting table, progress tracker, Q&A, list or paragraph) is its own shared document: put it on several pages, paste its link into a Chat message, open it on its own, and every copy is the same component, updated as people type.

- **Web and API:** Next.js 16 + Postgres (port 3770)
- **Live co-editing:** a [Hocuspocus](https://github.com/ueberdosis/hocuspocus) (Yjs) server, `server/collab.mjs` (port 3771). It saves each shared document to the same database, with its plain text for search and eDiscovery.
- **Editor:** [Tiptap](https://tiptap.dev) with Yjs collaboration and live cursors. Type `/` on an empty line for the insert menu.
- **Auth:** the suite gateway signs people in; `@synergy/identity` reads the signed-in user from its headers, on page requests and on the collaboration WebSocket alike.

## What it does

- **Workspaces:** an owner and members who can edit or only view; a page tree with pages inside pages.
- **Pages:** rich text (headings, lists, checklists, tables, links) edited together live, with everyone's cursor shown.
- **Components:** made from the insert menu on a page or from Loop home. Who can open one: its owner, people added to it, the people in its home workspace, and (by default) anyone in the organization with the link. The owner can narrow the link to view only or to the named people.
- **In Chat:** a message containing a component's link shows the component itself, live and editable, sized to fit.
- **Copilot:** draft text, summarize a page, or turn a page's action items into a task list, on the suite's own AI model (`@synergy/ai`; `LOOP_AI_*` settings override the suite's `AI_*` ones for Loop only).
- **Search and compliance:** suite search finds pages in your workspaces and components you have access to (`POST /api/search`); the Admin center's eDiscovery searches and exports pages and components (`POST /api/compliance/{search,export}`). Anything deleted while someone on it is on legal hold is kept hidden instead.

## Run it locally

You need Node 22 and a Postgres database.

```
docker run -d --name loop-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5499:5432 postgres:16-alpine
docker exec loop-pg createdb -U postgres loop
npm install && npm run build:packages            # from the repository root

cd apps/loop
export DATABASE_URL=postgres://postgres@127.0.0.1:5499/loop
export DEV_USER_EMAIL=you@example.com
npm run dev                                      # http://localhost:3770
npm run collab                                   # in a second terminal
```

The tables are created on first request. Without `SUITE_DOMAIN`, browsers connect to the collaboration server at `ws://localhost:3771`.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. The web app and the collaboration server need the same one. |
| `SUITE_DOMAIN` | The suite's domain. Browsers then reach the collaboration server at `wss://loop.<domain>/collab`, and other suite apps may show components in frames. |
| `LOOP_COLLAB_URL` | Overrides where browsers reach the collaboration server. |
| `COLLAB_PORT`, `COLLAB_ADDRESS` | Where the collaboration server listens (default `127.0.0.1:3771`; the Docker deploy uses `0.0.0.0`). |
| `DEV_USER_EMAIL` | Signs every request in as this user when there's no gateway. Ignored when `NODE_ENV=production`. |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `COMPLIANCE_TOKEN`, `ADMIN_INTERNAL_URL` | The Admin center's eDiscovery searches and legal holds. |
| `AI_*`, `LOOP_AI_*` | The AI model for Copilot (see `packages/ai`). |

## Tests

`npm test` runs the document tests; with `TEST_DATABASE_URL` set it also runs the access, search and eDiscovery tests and starts the real collaboration server to check live editing between people, read-only viewers and refused connections.

## Production

Deployed with the rest of the suite as the `loop` and `loop-collab` services in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md). Existing installs need `CREATE DATABASE loop;` in the suite's Postgres before the first start.
