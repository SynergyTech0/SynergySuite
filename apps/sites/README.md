# Sites (SharePoint equivalent)

A block-based page builder for team sites and landing pages. Each site has a theme and pages made of blocks (hero, heading, text, image, call to action, columns, embedded form, booking page, embed, footer), and published pages are served as plain HTML at `/s/:site` and `/s/:site/:page`.

## Team sites and permissions

- **Team sites** are private: only their owners, members and visitors can open them, find them in search or see their documents. **Communication sites** can be read by everyone signed in and can be published to the web. A site can switch between the two in its settings; a private site is never published.
- **Roles:** owners manage settings, access, publishing and deleting; members edit pages and documents; visitors read. Access can be given to a person (by email) or to a group (`group:<id>`), and a site always keeps at least one owner.
- **Group sites:** a group's owners can make a site for it. The group's owners own the site and its members are site members, following the group as it changes, and the site shows up on the team (a Site tab). Groups come from the Groups app through `@synergy/groups`; when it can't be reached, group grants give nobody access.
- **Document library:** every site gets a Drive shared library (when Drive is linked). Sites keeps its people in step with the site's (owners, editors, viewers, with groups expanded; re-synced every `SITES_SYNC_MINUTES` for sites with groups), and the site's Documents tab lists it, with uploads, previews and versions in Drive. A site can't be deleted while its library holds files.
- **Search and eDiscovery:** suite search only finds sites and pages the person can open. The Admin center searches and exports every page through `/api/compliance` (COMPLIANCE_TOKEN); a page deleted while its site's owner or its editors are on legal hold is kept out of sight, and a site holding such pages can't be deleted.

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

`npm test` runs the unit tests; with `TEST_DATABASE_URL` set it also runs search, permissions, group sites, document libraries and compliance against a real Postgres (Groups, Drive and the Admin center are faked).

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `PORT` | Port to listen on (default 3170). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |
| `SUITE_DOMAIN` | The suite's domain. Form blocks embed `https://forms.<domain>/f/<slug>`; without it they use the local forms port. |
| `SITES_BOOKING_URL` | Base URL of the Bookings app (compose sets `https://bookings.<domain>`). A Booking block embeds `<url>/book/<page>` or `<url>/book/<page>/<service>`, using the block's owner and slug fields, and is left out when this is unset. |
| `SITES_DRIVE_URL` | Drive on the internal network (compose sets `http://drive:3180`). With `DRIVE_SVC_TOKEN`, each site gets a document library. |
| `DRIVE_SVC_TOKEN` | Shared with Drive, for its `/api/svc/libraries`. Empty = no document libraries. |
| `SITES_DRIVE_PUBLIC_URL` | Where people open Drive (default `https://drive.<SUITE_DOMAIN>`). |
| `SITES_SYNC_MINUTES` | How often libraries of sites with group access are re-synced with the groups (default 5). |
| `GROUPS_INTERNAL_URL` | The Groups app, read by `@synergy/groups`. Without it there are no groups. |
| `COMPLIANCE_TOKEN`, `ADMIN_INTERNAL_URL` | The Admin center's eDiscovery searches and legal holds (see `packages/compliance`). |
| `SITES_LIVECHAT_URL` | Base URL of a live chat widget server. Sites with a live chat key load `<url>/widget.js`; nothing loads when this is unset. |

## Production

Deployed with the rest of the suite as the `sites` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md).
