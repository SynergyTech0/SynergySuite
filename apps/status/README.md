# Synergy Status

Uptime monitors and a public status page, the suite's answer to Microsoft 365 Service health. Rebuilt from the earlier standalone Status tool on the suite's shared packages.

- **Monitors.** A name and a web address, checked every `interval` seconds (at least 60). A check passes on the expected status or any 2xx/3xx answer, so a page behind a sign-in redirect counts as up. Each check keeps its status code, response time and, when it failed, why. The console shows the last result, 24-hour and 30-day uptime and the average response time; "Check now" runs one straight away.
- **Safe checks.** Checks run from the server, so they never reach private or internal networks: only http and https, the standard web ports (80, 443, 8080, 8443), no user names in addresses, and every address a name resolves to must be public. The connection goes to the address that was checked, and every redirect (up to five) is checked the same way. `STATUS_ALLOW_HOSTS` (comma-separated host names or addresses) allows particular internal hosts, such as the suite's own apps when they resolve to a private address.
- **Incidents.** Post an incident with a status (investigating, identified, monitoring, resolved) and follow it with updates. Resolved incidents stay on the public page for two weeks.
- **Public page** at `/status`, no sign-in: an overall banner, each public monitor with its 30-day uptime and a bar per day, and recent incidents. It refreshes every two minutes and never shows addresses, error text or who posted. The same data is at `/api/public/status` as JSON. The page title and an introduction are set in the console.
- **Suite apps.** "Add the suite's apps" adds a monitor for `https://<app>.<SUITE_DOMAIN>/` for every app, skipping ones already there. Nothing is pre-loaded.
- **Access.** Status admins (`STATUS_ADMIN_EMAILS`, default `ADMIN_EMAILS`) add monitors and post incidents; everyone else signed in can look.
- **Provisioning API.** `GET` and `POST /api/svc/monitors` with `Authorization: Bearer $STATUS_API_TOKEN`, on the internal network only (the gateway refuses `/api/svc/*` from outside). It can read and add monitors, not change or delete them.
- Checks older than `STATUS_RETENTION_DAYS` (default 90) are dropped once a day. `STATUS_POLLER=off` stops the checks (for a second replica).

The `monitors`, `checks` and `incidents` tables keep the earlier tool's columns, so its data loads straight in with `pg_dump --data-only -t monitors -t checks -t incidents`.

Port 3880, database `status`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/status`.
