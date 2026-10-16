# Self-hosting

`compose.yml` runs the suite apps that are on the shared packages (admin, base, books, bookings, cad, calendar, chat, contacts, crm, desk, drive, engage, forms, insights, mail, meet, notes, office, photo, planner, search, sites, todo, trust, hr (which took over the People add-on's database) and the portal add-on) plus the Stalwart mail server, Metabase (for Insights), the identity provider, a sign-in gateway and one Postgres. Other apps join as they move onto the shared packages.

```
browser ─► caddy ─► oauth2-proxy (checks the SynergyAuth session) ─► app
                └─► auth (SynergyAuth login, MFA, SSO)
```

Caddy is the only service with open ports. It removes any identity headers the browser sent, asks oauth2-proxy who is signed in, and forwards the request with that identity plus `X-Proxy-Auth-Secret`. Apps refuse requests without the secret, so the identity headers can't be forged by talking to an app directly.

## Try it on your machine

```
git clone https://github.com/SynergyTech0/SynergySuite.git
cd SynergySuite
deploy/quickstart.sh            # or: deploy/quickstart.sh calendar chat   (only those apps)
```

You need Docker with Compose v2, `openssl` and a bash shell (on Windows, WSL or Git Bash). When it finishes it prints the address and the admin sign-in; open `https://calendar.suite.lvh.me` and sign in as `admin@suite.lvh.me` with the password it shows (also in `deploy/.env`).

What the script does:

- On the first run it writes `deploy/.env` from `.env.example`: random secrets, the domain `suite.lvh.me`, an admin email and password, the gateway's OIDC client ID and secret, `CADDY_GLOBAL_OPTIONS=local_certs`, and every published port bound to `127.0.0.1` (mail on 2525/4465/4993 instead of 25/465/993). Later runs reuse that file unchanged. Set `SUITE_DOMAIN` before the first run to pick another domain.
- It downloads the suite's images from the GitHub Container Registry (see Prebuilt images below), retrying any that don't come down, and builds here only the ones it can't download. `SYNERGY_BUILD=local` builds every image here instead. Local builds run in batches of 4 services (Compose and BuildKit otherwise build every image at once) and retry a batch up to 3 times if a download drops (finished images come from the cache). On a slow connection set `SYNERGY_BUILD_PARALLEL=1` (or 2); `SYNERGY_BUILD_ATTEMPTS` changes the number of tries. Then it runs `up -d`.
- It waits until an app sends a signed-out visitor to sign-in, copies Caddy's local root certificate to `deploy/local-ca.crt` and prints how to trust it.

How the local domain works, and the trade-offs:

- **Browsers**: `lvh.me` is a public DNS name whose every subdomain resolves to `127.0.0.1`, so `auth.suite.lvh.me`, `sso.suite.lvh.me` and `calendar.suite.lvh.me` all reach Caddy on your machine with no setup. It depends on a third party's DNS and on a network connection, and some routers drop DNS answers that point at `127.0.0.1` (DNS rebinding protection). The script warns when `auth.suite.lvh.me` does not resolve to `127.0.0.1` and prints the `/etc/hosts` line that fixes it. `*.localhost` would need no DNS at all, but the identity provider refuses a `localhost` issuer in production mode and not every browser and OS resolves `*.localhost`, so it is not used.
- **Certificates**: with `local_certs`, Caddy signs certificates with its own CA instead of asking Let's Encrypt (which cannot reach your machine). Until you trust `deploy/local-ca.crt`, the browser shows a certificate warning on each subdomain. The CA's key stays in the `caddy-data` volume.
- **Containers**: nothing inside the compose network needs to resolve the suite domain or trust Caddy's CA. The gateway (oauth2-proxy) sends the browser to `https://auth.<domain>` to sign in, but redeems codes and fetches signing keys from `http://auth:3500` directly, and checks ID tokens against the public issuer. The same holds on a server, where it also avoids hairpin NAT.
- **Ports**: Caddy must be on 443 (and 80) of `127.0.0.1`, because sign-in redirects go to `https://<host>/` without a port. Stop whatever else holds 443 first.
- **Not covered locally**: meetings need the LiveKit media server from `apps/meet/deploy`, and mail stays on this machine (nothing can deliver to `suite.lvh.me`).

Stop with `docker compose -f deploy/compose.yml --env-file deploy/.env down`; add `-v` and delete `deploy/.env` to start over.

## Prebuilt images

`.github/workflows/images.yml` builds each app's image on every push to `main` that changes it (a manual run of the workflow builds them all) and publishes it as `ghcr.io/synergytech0/synergysuite-<app>`, tagged `latest` and with the commit. The images carry no domain, so the same image runs anywhere. `deploy/compose.yml` names these images, so `docker compose pull` fetches them; `SYNERGY_IMAGE_TAG=<commit>` pins a commit's images and `SYNERGY_REGISTRY` points at another registry.

The images are public, so no login is needed. If they can't be downloaded, quickstart builds them here instead. The images are built for x86-64 (`linux/amd64`). An ARM machine such as an Apple Silicon Mac runs them under emulation; `SYNERGY_BUILD=local` builds native ones instead.

## First start on a server

1. Point DNS for `auth`, `sso`, `admin`, `base`, `books`, `bookings`, `cad`, `calendar`, `chat`, `contacts`, `crm`, `desk`, `drive`, `engage`, `forms`, `insights`, `mail`, `meet`, `notes`, `office`, `people`, `hr`, `photo`, `planner`, `portal`, `search`, `sites`, `todo` and `trust` under your domain at the host. For mail, also add an A record for `mx` and an MX record for the domain pointing at `mx.<domain>` (see Mail below).
2. `cp deploy/.env.example deploy/.env` and fill it in. For the gateway, choose `OIDC_CLIENT_ID` (e.g. `suite-gateway`) and a random `OIDC_CLIENT_SECRET`; leave `CADDY_GLOBAL_OPTIONS` empty so Caddy gets Let's Encrypt certificates.
3. Start everything: `docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build`.
4. Sign in at `https://auth.<domain>/admin` as `SEED_ADMIN_EMAIL` (default `admin@<domain>`). With `SEED_ADMIN_PASSWORD` empty, the password is printed once by `docker compose -f deploy/compose.yml --env-file deploy/.env logs auth-init`; change it after signing in.

`auth-init` runs on every `up` before the gateway starts. It creates the admin only if that account does not exist (it never resets a password), and registers the "Suite gateway" OIDC client with redirect URI `https://sso.<domain>/oauth2/callback`, or brings an existing client with that ID back in line with `.env` (secret, redirect URI, first-party, enabled). Deploys that registered the client by hand in the admin page keep working: keep its ID and secret in `.env`.

## Demo mode

For a public demo instance, set `DEMO_MODE=1` in `deploy/.env` and run `docker compose -f deploy/compose.yml --env-file deploy/.env up -d` again (or start a fresh local demo with `DEMO_MODE=1 deploy/quickstart.sh`). It is off by default and changes nothing else when off.

- **Sample company.** The `demo` service seeds Juniper Bay Studio, a made-up design studio: the shared demo user Sam Rivera plus four colleagues, a week of calendar events, a small wiki in Notes, channels and direct messages in Chat, two planner boards with cards, checklists and comments, and a few messages in the demo user's mailbox. The content lives in `deploy/demo/content.mjs`; dates follow the current week.
- **Shared login.** The sign-in page shows the demo account and its password (`DEMO_EMAIL`, default `demo@<MAIL_DOMAIN>`; `DEMO_PASSWORD`, default `SynergyDemo1`) and fills them in. That account can't change its password, set up two-step verification or passkeys, reset its password by email, see or end other visitors' sessions, or be locked out by wrong passwords. The admin account works as usual.
- **Hourly reset.** At the top of every hour (every `DEMO_RESET_MINUTES`, default 60) the `demo` service puts calendar, chat, notes and planner back to the sample content, empties and refills the demo and colleague mailboxes, and restores the demo account (password, no MFA or passkeys, not locked). It wipes everything in those apps, including what the admin added, so use demo mode only on an instance that exists to be a demo. Watch it with `docker compose -f deploy/compose.yml --env-file deploy/.env logs -f demo`; `restart demo` resets right away.
- **No outbound email.** Stalwart refuses to relay to outside domains and routes every queued message to local delivery (`deploy/stalwart/plan.demo.ndjson`, applied by `stalwart-plan`). Mail only sends from the suite mailbox to `@<MAIL_DOMAIN>` addresses and won't connect outside IMAP accounts; the auth app sends no password-reset email and Meet sends no invitations.
- **Not reset.** Drive, Contacts, To Do, CRM, Desk, forms, sites, office, photo, CAD, meet and the add-ons keep what visitors make, and published forms and sites are public pages. For a public demo, start only the apps you want to show, e.g. `docker compose -f deploy/compose.yml --env-file deploy/.env up -d demo calendar chat notes planner mail`.

To turn demo mode off, clear `DEMO_MODE` and `up` again: the `demo` service exits, the sample content and demo account stay until you remove them (disable the account in `https://auth.<domain>/admin`), and Stalwart keeps refusing to relay until you restore its two settings in the admin UI: RCPT stage "Allow relaying" back to `!is_empty(authenticated_as)`, and the outbound routing expression back to `'local'` if `is_local_domain(rcpt_domain)`, else `'mx'`.

## Public paths

These skip sign-in at the gateway: published forms (`forms.<domain>/f/*`), published sites (`sites.<domain>/s/*`) calendar's machine API (`calendar.<domain>/api/svc/*`, which checks `CAL_SVC_TOKEN` itself), planner's automation API (`planner.<domain>/api/mind`, which checks `MIND_TOKEN`), Trust's public trust centre pages (`trust.<domain>/trust/*`) and collector-agent API (`trust.<domain>/api/agent/*`, which checks each agent's token), Drive's view links (`drive.<domain>/s/*` and `/api/shared/*`, which check the link's token), CRM's web-to-lead endpoint (`crm.<domain>/api/intake/lead`, which checks `CRM_API_TOKEN`), Desk's help center (`desk.<domain>/kb`), ticket intake (`/api/intake`) and Portal feed (`/api/svc/*`, both checking `DESK_API_TOKEN`), and Base's data links (`base.<domain>/api/feed/*`, which check the link's token).

## Mail

`mail.<domain>` is the web mailbox. It reads and sends through Stalwart, the mail server in the same compose file, and users can also connect outside IMAP accounts (Gmail, Outlook.com, anything with IMAP/SMTP) next to their suite mailbox.

- Each signed-in user gets a mailbox at their sign-in address the first time they open Mail. Their address must be in `MAIL_DOMAIN` (defaults to your suite domain).
- Mail opens mailboxes with one service login (`webmail@MAIL_DOMAIN`, allowed to open any mailbox), so users never type a mail password in the browser.
- Stalwart's settings live in its own database. `stalwart-plan` and `stalwart-init` apply `deploy/stalwart/plan.template.ndjson` on every `up`: the mail domain, the server name, the admin and the service login. Everything else (DKIM, spam filtering, certificates) is managed in Stalwart's admin UI at `http://127.0.0.1:8080` on the host (sign in as `admin` with `STALWART_ADMIN_PASSWORD`; use an SSH tunnel from elsewhere).
- Stalwart publishes 25 (incoming mail), 465 (sending from desktop and phone clients) and 993 (reading from them). Many cloud hosts block port 25; ask yours to open it or relay through a smarthost.
- To receive mail from the internet you need: an MX record for your domain pointing at `mx.<domain>`, SPF and DKIM records (Stalwart's admin UI shows the DKIM record to publish), and reverse DNS for the host's IP set to `mx.<domain>`.
- Stalwart starts with a self-signed certificate. Give it a real one in its admin UI (ACME/Let's Encrypt is built in) before pointing desktop clients at it, then set `MAIL_SUITE_TLS_INSECURE=false`.

## Insights

`insights.<domain>` is the Power BI equivalent. Its report designer and charts are [Metabase](https://github.com/metabase/metabase), the open source edition (AGPL) from the official `metabase/metabase` image, unmodified, served at `insights.<domain>/studio` behind the suite sign-in.

- Set `INSIGHTS_SECRET` (`openssl rand -hex 32`; the quickstart writes one) and keep it: Insights derives every Metabase password and key from it. On first start Insights runs Metabase's setup with its own service account, so don't finish Metabase's setup wizard by hand.
- Nobody signs in to Metabase separately. When someone opens the designer, Insights makes their Metabase account and opens a session for them; the gateway checks on every designer request that the Metabase session belongs to whoever is signed in to the suite.
- The sources are the suite's own databases (`INSIGHTS_SOURCES`, default Books, CRM, Desk, Base, Planner, Forms and Trust). Insights reads them as a read-only Postgres role, `insights_reader`, that can't write and can't see columns named like passwords, tokens, keys, hashes, PINs or encrypted values. It re-checks every table at start and every `INSIGHTS_SYNC_MINUTES`; admins can also sync from Data sources.
- Roles: `INSIGHTS_ADMIN_EMAILS` (default `ADMIN_EMAILS`, else `SEED_ADMIN_EMAIL`) are Metabase admins; `INSIGHTS_ANALYST_EMAILS` (or `*`) can write their own queries; everyone else views the dashboards they can open. Fine-grained permissions are in the designer's admin settings.
- Dashboards appear inside Insights through Metabase's static embedding, signed by Insights only for people Metabase lets open them. The "Powered by Metabase" credit stays, as the open source edition requires. Metabase's paid features (white-labeling, SSO, interactive embedding, row-level permissions) are not used.
- Metabase needs about 1 GB of memory (`INSIGHTS_JAVA_OPTS`, default `-Xmx1g`) and takes a minute or two to start. Its own data (questions, dashboards, settings) is in the `metabase` database; back it up with the rest of Postgres.
