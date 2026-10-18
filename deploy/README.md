# Self-hosting

`compose.yml` runs the suite apps that are on the shared packages (admin, base, books, builder, bookings, cad, calendar, chat, commerce, contacts, contracts, crm, desk, devices, diagrams, drive, engage, field, flow (with the Activepieces flow engine), forms, groups, insights, law, livechat, analytics, status, loop, mail, meet, notes, office, ops, photo, planner, projects, search, sites, stream, todo, trust, vault, sms, shifts, hr (which took over the People add-on's database) and the portal, campaigns and sign add-ons) plus the Stalwart mail server, Metabase (for Insights), the identity provider, a sign-in gateway and one Postgres. Other apps join as they move onto the shared packages.

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
- **Meetings**: the `livekit` media server starts with Meet and Phone (`deploy/quickstart.sh meet` adds it). The script binds its media ports to `127.0.0.1` (7881/tcp, 7882/udp) and tells browsers to send media there, so calls work between browsers on this machine. To join from other machines on your network, see Meet and Phone media below.
- **Not covered locally**: mail stays on this machine (nothing can deliver to `suite.lvh.me`).

Stop with `docker compose -f deploy/compose.yml --env-file deploy/.env down`; add `-v` and delete `deploy/.env` to start over.

## Prebuilt images

`.github/workflows/images.yml` builds each app's image on every push to `main` that changes it (a manual run of the workflow builds them all) and publishes it as `ghcr.io/synergytech0/synergysuite-<app>`, tagged `latest` and with the commit. The images carry no domain, so the same image runs anywhere. `deploy/compose.yml` names these images, so `docker compose pull` fetches them; `SYNERGY_IMAGE_TAG=<commit>` pins a commit's images and `SYNERGY_REGISTRY` points at another registry.

The images are public, so no login is needed. If they can't be downloaded, quickstart builds them here instead. The images are built for x86-64 (`linux/amd64`). An ARM machine such as an Apple Silicon Mac runs them under emulation; `SYNERGY_BUILD=local` builds native ones instead.

## First start on a server

1. Point DNS for the domain itself (it opens the Hub), `auth`, `sso`, `admin`, `base`, `books`, `builder`, `bookings`, `campaigns`, `cad`, `calendar`, `chat`, `commerce`, `contacts`, `contracts`, `status`, `analytics`, `livechat`, `crm`, `desk`, `devices`, `devices-windows`, `diagrams`, `drive`, `engage`, `field`, `flow`, `flow-studio`, `forms`, `groups`, `insights`, `law`, `loop`, `mail`, `meet`, `notes`, `office`, `ops`, `people`, `hr`, `photo`, `planner`, `portal`, `projects`, `search`, `sign`, `sites`, `todo` and `shifts `trust`, `vault`, `sms` under your domain at the host. For mail, also add an A record for `mx` and an MX record for the domain pointing at `mx.<domain>` (see Mail below).
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
- **Not reset.** Drive, Contacts, To Do, CRM, Desk, forms, sites, office, photo, Stream, CAD, meet and the add-ons keep what visitors make, and published forms and sites are public pages. For a public demo, start only the apps you want to show, e.g. `docker compose -f deploy/compose.yml --env-file deploy/.env up -d demo calendar chat notes planner mail`.

To turn demo mode off, clear `DEMO_MODE` and `up` again: the `demo` service exits, the sample content and demo account stay until you remove them (disable the account in `https://auth.<domain>/admin`), and Stalwart keeps refusing to relay until you restore its two settings in the admin UI: RCPT stage "Allow relaying" back to `!is_empty(authenticated_as)`, and the outbound routing expression back to `'local'` if `is_local_domain(rcpt_domain)`, else `'mx'`.

## Public paths

These skip sign-in at the gateway: published forms (`forms.<domain>/f/*`), published sites (`sites.<domain>/s/*`) calendar's machine API (`calendar.<domain>/api/svc/*`, which checks `CAL_SVC_TOKEN` itself), planner's automation API (`planner.<domain>/api/mind`, which checks `MIND_TOKEN`), Trust's public trust centre pages (`trust.<domain>/trust/*`) and collector-agent API (`trust.<domain>/api/agent/*`, which checks each agent's token), Drive's view links (`drive.<domain>/s/*` and `/api/shared/*`, which check the link's token), CRM's web-to-lead endpoint (`crm.<domain>/api/intake/lead`, which checks `CRM_API_TOKEN`), Desk's help center (`desk.<domain>/kb`), ticket intake (`/api/intake`) and Portal feed (`/api/svc/*`, both checking `DESK_API_TOKEN`), Ops' demand and purchase-request feeds (`ops.<domain>/api/svc/*`, which check `OPS_API_TOKEN`), Base's data links (`base.<domain>/api/feed/*`, which check the link's token), and Commerce's online store (`commerce.<domain>/store/*` and `/api/store/*`; the payment provider's callback checks `COMMERCE_CHECKOUT_TOKEN`) and its stock API for other apps (`commerce.<domain>/api/svc/*`, which checks `COMMERCE_SVC_TOKEN`), and the flow engine's webhook triggers (`flow-studio.<domain>/api/v1/webhooks/*` and `/api/v1/app-events/*`, which only start a flow whose owner published a webhook trigger), and Sign's signing pages for outside signers (`sign.<domain>/sign/*`, `/api/signers/*` and `/api/files/*`, which check the signer's emailed token or a signed, expiring file link), and phone sync for Calendar and Contacts (`/dav/*`, `/.well-known/caldav` or `/.well-known/carddav`, and `PROPFIND`/`REPORT` on `/`, which check an app password; see below).

## AI model

Every AI feature in the suite (Copilot, drafting, summaries, lead scoring, captions and so on) uses one model, and AI stays off until one is set. The normal place to set it is the sign-in app's admin console: `https://auth.<domain>/admin`, **Settings > AI model**. Pick the provider (Anthropic (Claude), OpenAI, an OpenAI-compatible server such as vLLM, LM Studio, OpenRouter, Azure OpenAI or Groq, or Ollama), the model, and the API key, plus a base URL for a server of your own and, optionally, embedding and speech models. **Test** makes one small request with those settings and shows the model's answer or the provider's error. Every app picks up a saved change within a minute, without a restart; **Clear** goes back to the environment.

- The key is encrypted at rest with `SA_ENCRYPTION_KEY` and never sent back to the browser: the console shows only that a key is set and its last 4 characters. Only admins can see or change the section, and every save, test and clear is in the audit log (without the key).
- Apps read the settings from auth on the compose network (`GET http://auth:3500/api/internal/ai-settings`, the address in `AUTH_INTERNAL_URL`) with `PROXY_SHARED_SECRET`, which auth also needs. Caddy answers `404` for `/api/internal/*` on `auth.<domain>`, so they can't be read from outside. Each app keeps them for 60 seconds (`AI_SETTINGS_CACHE_MS`).
- The `AI_*` variables in `.env` are the fallback: apps use them when nothing is saved in the console, or when auth can't be reached before an app has read the settings once (after that, an app keeps the last settings it read). Saved settings replace the unprefixed `AI_*` set as a whole; an app's own prefixed variables (`SIGN_AI_MODEL`, `CRM_AI_MODEL` and so on) still win for that app.

## Copilot

Every app's header has a Copilot button that opens Search's `/copilot` page in a side panel frame. It works with no extra setup: the apps share the session cookie on `.SUITE_DOMAIN` (same site, so it reaches the frame), and Search allows only `https://*.SUITE_DOMAIN` to frame `/copilot` (`Content-Security-Policy: frame-ancestors`; its other pages can't be framed at all). The Account app's pages refuse frames, so if the session has expired the panel can't show the sign-in page: use its "Open in a new tab" link. Copilot uses the suite's AI model (see AI model above, or `SEARCH_AI_*`); Draft with Copilot in Mail and Calendar uses `MAIL_AI_*` and `CALENDAR_AI_*` when set. When the person confirms an action, Search calls To Do, Calendar, Chat or Planner on the compose network as that person (the gateway headers plus `PROXY_SHARED_SECRET`, as it does for search), so those apps' own permission checks apply.

## Flow

`flow.<domain>` is Synergy Flow, the suite's Power Automate. People see their flows there, start from recipes, turn flows on and off and follow their runs. Building a flow happens in the flow designer at `flow-studio.<domain>`, which is the [Activepieces](https://github.com/activepieces/activepieces) Community Edition (MIT) engine and designer, unchanged; Flow's About page credits it.

- **Sign-in.** Activepieces has its own accounts. Flow creates one per suite person (and a service account, created first, which becomes the engine's platform admin), with passwords derived from `FLOW_SECRET` that nobody types. Opening the designer from Flow passes through `flow-studio.<domain>/synergy/sso`, which signs the person in there. The gateway closes the engine's own sign-in, sign-up and invitation pages and requires a suite session for everything except webhook triggers.
- **Synergy steps.** Flow installs a "Synergy" piece in the engine (`apps/flow/piece`, built into the Flow image) and gives each person a "Synergy" connection. Its actions (send an email, create an event, add a To Do or Planner task, post in Chat, add a contact, save to Drive, open a Desk ticket, add a CRM lead) and polling triggers (new email, new form response) call Flow, which calls the app as the flow's owner, so every app applies its own access rules. Hundreds of outside services (Gmail, Slack, Stripe, HTTP and so on) come from Activepieces' own piece catalog, which the engine downloads.
- **Starting flows from other apps.** A flow that is on and starts with the Human Input piece's "Web Form" trigger (or a "Catch Webhook" trigger with no authentication) can be started by other suite apps, such as a Builder button, as the signed-in person: `GET /api/flows?trigger=manual` lists them with the form's fields as inputs, and `POST /api/flows/{id}/run` with `{ "inputs": { ... } }` starts one and answers `{ runId, status, outputs? }`. If the flow has a "Respond on UI" or "Return Response" step, the call waits for that answer (up to 30 seconds); otherwise it returns at once with status `running`.
- **Isolation.** The engine, its Postgres (`flow-db`) and Redis (`flow-redis`) are on their own `flow` network with only Flow and Caddy, so a flow can't reach the suite's database or call apps directly. Code steps run in V8 isolates (`AP_EXECUTION_MODE=SANDBOX_CODE_ONLY`).
- **Secrets.** `FLOW_SECRET`, `FLOW_DB_PASSWORD`, `FLOW_ENCRYPTION_KEY` (32 hex characters) and `FLOW_JWT_SECRET`; quickstart fills them in, also in an existing `deploy/.env`. Changing `FLOW_SECRET` revokes every Synergy key and locks people out of their engine accounts: remove those accounts in the designer's platform settings (signed in as `flow-service@<domain>`) and Flow recreates them, but their flows go with them.
- **Upgrading the engine.** `FLOW_ENGINE_VERSION` pins the Activepieces image (default `0.92.3`, the version Flow is tested with). Its own database migrates on start.
- Polling triggers check every `FLOW_POLL_MINUTES` (default 5).
- Known gaps: a person removed from the suite keeps their running flows until an admin turns them off in the designer; flows are not yet covered by Admin center holds and searches.

## Meet and Phone media

Meet's video rooms and Phone's calls run on the `livekit` service: the [LiveKit](https://github.com/livekit/livekit) media server (Apache-2.0, headless, so people only ever see Meet and Phone). The apps sign join tokens with `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (quickstart generates them; on a server pick a short key and `openssl rand -hex 32` as the secret) and manage rooms over the internal network (`http://livekit:7880`).

```
browser ─► caddy  wss://meet.<domain>/rtc ─► livekit:7880   (signalling, through the gateway)
browser ─────────────── 7882/udp or 7881/tcp ─► livekit       (audio and video, straight to it)
```

- **Ports**: open 7881/tcp and 7882/udp on the host. Every call shares the one UDP port; browsers whose network blocks UDP fall back to TCP 7881. `LIVEKIT_TCP_PUBLISH` and `LIVEKIT_UDP_PUBLISH` change what is published (e.g. `127.0.0.1:7881`); the port numbers inside must stay the same, since LiveKit announces them to browsers.
- **The address browsers send media to**: on a server, leave `LIVEKIT_NODE_IP` empty and LiveKit finds its public IP over STUN. If that fails (no outbound STUN: the `livekit` log then says `could not resolve external IP` and it keeps restarting; or a server behind 1:1 NAT), set `LIVEKIT_NODE_IP` to the public IP and `LIVEKIT_USE_EXTERNAL_IP=false`. Locally, quickstart sets `127.0.0.1`; for other machines on your LAN, set the machine's LAN IP, publish the two ports on it (`LIVEKIT_TCP_PUBLISH=7881`, `LIVEKIT_UDP_PUBLISH=7882`) and run `up -d livekit` again (they also need the suite's names to resolve to that IP and to trust `local-ca.crt`).
- **TURN**: there is no TURN relay in the compose file. TCP 7881 covers networks that block UDP. For networks that only allow web traffic, run coturn (BSD) on a different public IP with `use-auth-secret` and set `TURN_HOST` and `TURN_STATIC_SECRET`; Meet and Phone then hand browsers short-lived TURN logins.
- **Phone**: LiveKit sends its webhooks (who joined and left) to Phone at `http://phone:3440/api/livekit/webhook` (`LIVEKIT_WEBHOOK_URL`). Calls between colleagues need nothing more. Real phone numbers need LiveKit SIP: set `COMPOSE_PROFILES=sip` and `LIVEKIT_REDIS_ADDRESS=sip-valkey:6379` in `.env`, run `up -d` again, and open 5060/udp+tcp and 10000-10099/udp to your SIP provider (see `apps/phone/README.md`).
- **Recording** needs LiveKit Egress and Redis, which are not in this file yet (see `apps/meet/deploy`).
- **Your own media server**: to keep LiveKit on its own host (`apps/meet/deploy`), point `LIVEKIT_UPSTREAM` at it (host:port), use its keys, and leave the `livekit` service out (`up -d --scale livekit=0`). An existing host-network LiveKit on the same machine holds 7881, so stop it before starting this one.

## Mail

`mail.<domain>` is the web mailbox. It reads and sends through Stalwart, the mail server in the same compose file, and users can also connect outside IMAP accounts (Gmail, Outlook.com, anything with IMAP/SMTP) next to their suite mailbox.

- Each signed-in user gets a mailbox at their sign-in address the first time they open Mail. Their address must be in `MAIL_DOMAIN` (defaults to your suite domain).
- Mail opens mailboxes with one service login (`webmail@MAIL_DOMAIN`, allowed to open any mailbox), so users never type a mail password in the browser.
- Stalwart's settings live in its own database. `stalwart-plan` and `stalwart-init` apply `deploy/stalwart/plan.template.ndjson` on every `up`: the mail domain, the server name, the admin and the service login. Everything else (DKIM, spam filtering, certificates) is managed in Stalwart's admin UI at `http://127.0.0.1:8080` on the host (sign in as `admin` with `STALWART_ADMIN_PASSWORD`; use an SSH tunnel from elsewhere).
- Stalwart publishes 25 (incoming mail), 465 (sending from desktop and phone clients) and 993 (reading from them). Many cloud hosts block port 25; ask yours to open it or relay through a smarthost.
- To receive mail from the internet you need: an MX record for your domain pointing at `mx.<domain>`, SPF and DKIM records (Stalwart's admin UI shows the DKIM record to publish), and reverse DNS for the host's IP set to `mx.<domain>`.
- Stalwart starts with a self-signed certificate. Give it a real one in its admin UI (ACME/Let's Encrypt is built in) before pointing desktop clients at it, then set `MAIL_SUITE_TLS_INSECURE=false`.

## Phone and desktop sync (CalDAV and CardDAV)

People can add their suite calendar and contacts to the calendar and contacts apps on iPhone, iPad, Mac, Android (with DAVx5) and Thunderbird, and changes go both ways. Calendar serves CalDAV at `calendar.<domain>` and Contacts serves CardDAV at `contacts.<domain>`. Repeating events, their exceptions and alarms set on the phone sync too.

These apps can't do the suite's browser sign-in, so each person makes an **app password** on their Account page (`auth.<domain>/account`, "App passwords"): a name such as "My iPhone", then a 16-letter password shown once. They sign in with their email address and that password. App passwords are stored hashed, can be revoked one by one, show when they were last used, and are all revoked when the account password is reset. They skip two-step verification, which is why they are random, separate from the account password, and revocable.

**iPhone and iPad:** Settings > Apps > Calendar > Calendar Accounts > Add Account > Other > Add CalDAV Account. Server `calendar.<domain>`, User Name your email, Password the app password. For contacts: Settings > Apps > Contacts > Contacts Accounts > Add Account > Other > Add CardDAV Account, server `contacts.<domain>`. (On older iOS: Settings > Calendar or Contacts > Accounts.)

**Mac:** Calendar > Settings > Accounts > + > Other CalDAV Account, account type Manual, server `calendar.<domain>`. Contacts > Settings > Accounts > + > Other Contacts Account, CardDAV, server `contacts.<domain>`.

**Android:** install DAVx5 (free and open source, from F-Droid or Google Play). Add account > Login with URL and user name: base URL `https://calendar.<domain>`, your email and the app password; then add a second account with `https://contacts.<domain>`. Pick what to sync; events and contacts appear in the phone's own Calendar and Contacts apps.

**Thunderbird:** New Calendar > On the Network, location `calendar.<domain>`, your email; for contacts, New Address Book > Add CardDAV Address Book with `https://contacts.<domain>`.

What each person sees:

- Calendar: **Calendar** (their own events, read and write), **Company** (the company calendar; anyone can add, only the organizer changes an event) and **Invitations** (other people's events they're invited to, read only). Group calendars from the Groups app aren't offered over CalDAV yet; their events show in the web app.
- Contacts: **Contacts**, their own address book, read and write. Groups sync as vCard categories. The organization directory isn't offered over CardDAV yet.

Wrong passwords: the account service locks a person's app passwords for 15 minutes after 10 wrong tries, and an address for 15 minutes after 30; Calendar and Contacts each also stop asking for an address after 20 wrong tries in 10 minutes. Correct sign-ins are remembered for a minute, so a revoked app password can keep working for up to a minute. The account service's check (`/api/internal/*`) is reachable only on the compose network, with `PROXY_SHARED_SECRET`.

Not included:

- **Exchange ActiveSync** is not implemented: it is Microsoft's protocol and licensed under patents. Every current phone and desktop app speaks CalDAV and CardDAV instead.
- Meeting invitations aren't sent from a phone (no CalDAV scheduling, RFC 6638): an event with attendees made on a phone shows in their Invitations, without an email.
- Time zones are sent as IANA names without VTIMEZONE blocks, which all the clients above read.

**Why not Stalwart's CalDAV and CardDAV?** Stalwart, the bundled mail server (v0.16), does serve CalDAV and CardDAV. It isn't used for this because its calendars and address books are a separate store with its own accounts (mail principals): events made there wouldn't show in Calendar, free/busy, Bookings, suite search or eDiscovery, and keeping two stores in step both ways would be fragile. Serving the protocols from Calendar and Contacts keeps one copy of the data and the suite's own sign-in, holds and retention.

## Sign

- Sign (e-signatures) is an add-on with its own database (`sign`) and a `sign-files` volume for uploaded and signed PDFs. People in the suite sign in as everywhere else; a Sign account from before is matched by email. Signers outside the organization need no account: they open the link in their email.
- `SIGN_ADMIN_EMAILS` (default `SEED_ADMIN_EMAIL`) get Sign's admin pages. Signing requests and completed documents go out from `sign@<MAIL_DOMAIN>` through Stalwart, which Sign creates on first use; `SIGN_SMTP_*` sends through one outside mailbox instead. Signers outside your domain only receive mail once Stalwart can deliver to the internet (see Mail).
- Field detection uses `@synergy/ai` (`SIGN_AI_*`, else the suite's `AI_*`); it needs a model that reads images.
- Known gaps: the Android app and the hosted product's billing, affiliate and enterprise-invitation pages are not wired to the suite (billing pages are hidden); deleting a document under legal hold hides it but keeps it for the hold.

## Groups

`groups.<domain>` holds the suite's groups. A team gets a workspace in Chat with a channel per team channel, a library in Drive, a group calendar in Calendar and, with an address, a shared mailbox in Mail; a distribution list becomes a Stalwart mailing list (outside addresses allowed); a shared mailbox becomes a Stalwart group account its members open in Mail.

- Groups pushes each change to Chat, Drive, Calendar and Mail on the compose network, and again every 15 minutes for every group, so an app that was down catches up. A team's Settings tab shows whether each app took the last change.
- Team calendars need `CAL_SVC_TOKEN` on Groups and Calendar (quickstart sets it). Mailboxes need Mail's Stalwart admin login, which compose already gives it.
- `/api/svc/*` on groups, chat, drive and mail is answered only on the compose network (with `PROXY_SHARED_SECRET`); the gateway returns 404 for it.
- `GROUPS_ADMIN_EMAILS` may manage and restore every group; `GROUPS_CREATE=admins` keeps creating groups to them.

## The Hub and linked apps

Account's Hub (`https://auth.<SUITE_DOMAIN>/hub`, also "All apps" at the bottom of every app's launcher) lists the suite apps plus any **linked apps**: tools the company runs somewhere else. Add, hide, restrict and grant them in Account > Admin > Apps. A restricted app shows only to the people granted it. The launcher in every app's header shows the same list, grouped by category, from `https://auth.<SUITE_DOMAIN>/api/launcher`; when it can't get it (signed out, Account down) it lists the suite apps instead.

### Moving from an older Synergy Hub

If you ran the standalone SynergyAuth Hub before the suite, bring its people and apps across from the repository root:

```bash
deploy/hub-import/run.sh auth root@your-hub-server --dry-run   # see what would happen
deploy/hub-import/run.sh auth root@your-hub-server
```

It reads the hub's database over your own SSH access (container `saauth-db`, or set `HUB_DB_CONTAINER`). People keep their passwords. Anyone who already has an account here keeps it unchanged unless you add `--overwrite-passwords`. Two-step sign-in has to be set up again, because the hub encrypted those secrets with its own key. Hub apps the suite now covers (Boards, Docs, Cal, Books and so on; the list is `COVERED` in `apps/auth/scripts/import-hub.mjs`) are replaced by their suite apps. Every other hub app becomes a linked app at its old address, with its grants. Running it again only adds what is missing.

Then the hub's apps, one part at a time, each with `--dry-run` first (`ls deploy/hub-import/*.sql` lists them). Run `auth` first: the other parts find people by email.

```bash
deploy/hub-import/run.sh planner root@your-apps-server --dry-run
```

- `planner` (SynergyBoards, container `sboards-db`): SynergyBoards workspaces, boards, members, lists, cards (issue keys, sprints, assignees, labels, checklists, comments, links, custom fields, work logs), activity history and automations, into Planner as they were. People are matched by email; anyone not yet in Planner gets their boards when they first sign in. Uploaded attachment files stay on the hub (link and Drive attachments come across), as do pending invites and notifications.
- `trust` (SynergyTrust, container `strust-db`): controls, evidence, monitors and their run history, policies, risks, vendors, personnel, assets, GDPR records, audits, agents, the trust centre and both logs move into the suite's Trust organisation (the only one, the one named with `--tenant <slug>`, or a new one under the hub's name). People and memberships match by email and sign in through the suite; Trust passwords, second factors, sessions and invitations stay behind. The framework catalog is matched by key, not copied. The audit trail is re-chained in the suite with original times, ending in a `hub.imported` event that records the hub chain's head hash. A live collector agent keeps its token: point it at `https://trust.<domain>`.
- `books` (SynergyBooks, container `synergybooks-db`): the hub's organization becomes a new company in Books with its chart of accounts, journals (the trial balance is checked against the hub's before anything is saved), AI tax classifications, customers, invoices, bank accounts and bank transactions, and its people (matched by email) get access to it. Add `--into-org <company id>` to put it into a company you already have instead (accounts are matched by number; journal and invoice numbers already in use get a `HUB-` prefix). The IRC library the Tax AI reads comes along too, unless it is already there or you add `--skip-tax-library`. Bank accounts come with their last four digits only, as the hub kept them, and with their transaction history; new transactions sync only if Books can reach the payments service that linked them (`PAY_SERVICE_URL` and `PAY_SERVICE_TOKEN` in the Books container), otherwise link the bank again in Books.
- `bookings` (Booking by Synergy, container `scadence-db`): each team becomes a booking page at its team address with its members as staff, and each person with event types of their own gets a page at their user name with their weekly availability as its hours. Event types become services with the same address, length, buffers, location, price, questions and email reminders; round-robin types are booked with anyone available. Hidden and inactive types arrive switched off. Staff are matched to suite accounts by email; if someone signs in here with another address, add `--map-email old@example.com=new@example.com` so the pages are theirs. Bookings, calendar connections and webhooks stay behind, and booking links move to `bookings.<domain>/book/<page>/<service>`, so update the links on your sites.
- `sign` (SynergySign, container `ssign-db`): documents with their signers, fields, audit trail and notifications, and the original and signed PDFs, which `sign.files.sh` reads from the old app's volume (container `synergysign-app`, or set `HUB_FILES_CONTAINER`). People are matched by email; anyone new gets a Sign user and signs in with their suite account. Sign admins still come from `SIGN_ADMIN_EMAILS`. Plans and billing, affiliate and enterprise records, templates and contract events the hub never sent stay behind. The PDFs are written to Sign's volume (`LOCAL_STORAGE_PATH`), not to an S3 backup.
- `docs` (SynergyDocs, container `sdocs-db`): every document, spreadsheet and presentation with its sharing, comments and version history. Office grew out of SynergyDocs and stores them the same way, so they open as they were, in this suite's organization (`DOCS_ORG`). Open Office once before importing so it has set up its database.
- `drive` (SynergyDrive, container `sdrive-postgres`): folders, files and their versions into each owner's own files; `drive.files.sh` reads the contents from the old object storage through the old API container (`sdrive-api`). The old Drive knew people only by an id made from their email, so they are matched against the suite's accounts and anyone already in Drive; add `--email someone@example.com` for anyone it lists as unknown. A folder that already exists by name is used as it is, and a file whose name is taken gets "name (1)". The hub's recycle bin and shared drives stay behind, and imported files don't count against quotas. Open Drive once before importing.
- `routes` (SynergyRoutes, container `synergyroutes-db`, user and database `synergyroutes`): the CRM side of SynergyRoutes into CRM: about 160,000 healthcare accounts (pharmacies, nursing facilities, home health agencies, hospices, hospitals, practices) with their address, position and entity type (as the industry), each with its main phone line as a contact, and the opportunities and activities. Visit priority and frequency, last visit, next action date and the registry facts (ratings, beds, ownership, license and so on) become each account's details. Owners are matched by email (`--map-email` as for `bookings`; `--owner <email>` for unowned records, otherwise the CRM's first admin), and anyone not yet in the CRM is added as a rep. Open the CRM once before importing. It streams one row per line and writes 1,000 at a time, so it takes a minute or two; running it again updates what changed. Territories, routes and route stops stay behind. See `apps/crm/README.md`.

Each part keeps the hub's ids, so running it again skips what is already here, and something deleted here after an import comes back if you import again. The files of `sign` and `drive` travel inside the same SSH stream as the rows (base64, about a third larger) and are never written to disk on the way.

## Adding your own apps

Apps you don't want in this repository (your own products, paid add-ons) can run inside the same deploy, behind the same sign-in and in the same launcher, from a repository of your own. Nothing in this repository changes; you add a second compose file next to `compose.yml`:

```bash
docker compose -f deploy/compose.yml -f /path/to/your/compose.extra.yml --env-file deploy/.env up -d
```

- **Services.** The extra file adds your apps as services. They join the suite's network, so they reach `postgres`, `auth` and the other apps by name, and can use the shared settings (`PROXY_SHARED_SECRET`, `SUITE_DOMAIN`, `AUTH_INTERNAL_URL`). Create their databases with a one-off service of your own; the suite's `postgres-dbs` only knows the suite's.
- **Addresses.** Mount a folder of Caddy site files at `/etc/caddy/sites.d` on the `caddy` service. The Caddyfile reads every `*.caddy` file in it and they can use its snippets, so a signed-in app is:

  ```
  myapp.{$SUITE_DOMAIN} {
  	import signed_in
  	import to_app myapp:4000
  }
  ```

  Behind the gateway your app gets the person's identity in the `X-Auth-Request-Email` header and the proxy secret in `X-Proxy-Auth-Secret`, exactly as the suite's apps do (`@synergy/identity` checks both). Add the host to DNS like the others.
- **Launcher.** Add a tile for each app in Account > Admin > Apps (or insert it into `sa_apps` from a one-off service); it then shows in the Hub and in every app's launcher.
- **Look.** Build the app on the shared packages (`@synergy/shell` for the header and launcher, `@synergy/identity`, `@synergy/db`) and it looks and signs in like the rest of the suite. A git submodule of this repository is the simplest way to get them.

When you update the suite, pull or bump this repository and run the same command again: your apps stay as they are.

## Moving from Microsoft 365

The Admin center's **Move from Microsoft 365** page (`admin.<domain>`, global admins only) copies a Microsoft 365 tenant into the suite: each person's mail (every folder, read and flag state, received dates, as the original MIME), OneDrive (with file dates), calendar, contacts and To Do, and SharePoint document libraries into Drive shared libraries. It only reads from Microsoft 365; nothing there is changed. It is early: see "What is not copied" below.

Before the first source, set `MIGRATION_ENCRYPTION_KEY` in `deploy/.env` (`openssl rand -base64 32`; quickstart does it) and restart `admin`. The tenant's client secret and any IMAP passwords are stored encrypted with it and never shown again or logged. Changing the key means entering the secrets again. The Admin center also needs `ADMIN_SCIM_TOKEN` to create the accounts people move into (see People), and the apps need `PROXY_SHARED_SECRET` as usual: the Admin center writes into Mail, Drive, Calendar, Contacts and To Do through their normal APIs as each person, so quotas, legal holds and audit apply as if they had done it themselves.

### Register the app in Microsoft Entra

The customer's Global Administrator does this once, in about five minutes:

1. Sign in to [entra.microsoft.com](https://entra.microsoft.com), open **Applications > App registrations > New registration**. Name it "Synergy migration", keep **Accounts in this organizational directory only**, leave the redirect URI empty, and register.
2. On the overview page copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **API permissions > Add a permission > Microsoft Graph > Application permissions**, add (all read-only):

   | Permission | Why |
   | --- | --- |
   | `User.Read.All` | list the tenant's people |
   | `Mail.Read` | read every mailbox, as raw messages |
   | `Calendars.Read` | read calendars |
   | `Contacts.Read` | read contacts |
   | `Files.Read.All` | read OneDrive files |
   | `Sites.Read.All` | read SharePoint sites and their document libraries |
   | `Tasks.Read.All` | read To Do lists and tasks |
   | `GroupMember.Read.All` | optional: bring a group site's owners and members across as library members |
   | `Reports.Read.All` | optional: mailbox sizes in discovery (also turn off "Display concealed user, group, and site names in all reports" under Settings > Org settings > Reports in the Microsoft 365 admin center, or the sizes can't be matched to people) |

4. Choose **Grant admin consent for &lt;organization&gt;** and confirm; each permission shows a green tick.
5. **Certificates & secrets > New client secret**, with an expiry that covers the project. Copy its **Value** (not the Secret ID); it is shown once.
6. In the Admin center: **Move from Microsoft 365 > Connect Microsoft 365**, paste the tenant ID, client ID and secret. They are tested before they are saved.

Only plain HTTPS to `login.microsoftonline.com` and `graph.microsoft.com` is used (client-credentials token, Graph v1.0); no Microsoft code or SDK. `M365_LOGIN_URL` and `M365_GRAPH_URL` point it at a national cloud. Delete the app registration when the move is finished.

### Discover, map, copy

- **Discover** lists the tenant's people (guests left out) with mailbox and OneDrive sizes, and its SharePoint sites with their size and, for group sites, owners and members.
- **Map** each person to a suite account: type it in, or fill a domain and choose **Map unmapped** to give everyone `name@that-domain`. **Create missing accounts** creates the accounts in the sign-in service (people set their password with "Forgot password") and their mailboxes.
- **Copy** queues one background job per person (two run at a time, `MIGRATION_CONCURRENCY` for more). Jobs survive restarts: one interrupted by a crash or a deploy carries on where it stopped. Microsoft's throttling (429 with Retry-After) is waited out as asked; a run that fails as a whole (Microsoft or a suite app unreachable) is tried again later, up to five times. Each person gets a report (counts copied, updated, deleted, skipped with the reason, errors, and the CSV to download).
- **SharePoint sites** become Drive shared libraries named after the site, created and owned by the admin who starts the copy, with the site's owners as owners and members as editors when they have suite accounts.
- Messages over 45 MB (`MIGRATION_MAX_MESSAGE_MB`) and files over Drive's limit are skipped and listed. Calendar events from three years back to three years ahead are copied (`MIGRATION_CALENDAR_PAST_DAYS`, `MIGRATION_CALENDAR_FUTURE_DAYS`).

### Cutover checklist

1. A week or so before: connect, discover, map, create accounts, and copy everyone. Check the reports and copy again anyone with errors.
2. Lower the TTL of the domain's MX record (say to 5 minutes) a day ahead.
3. At cutover: add the domain to the suite's mail server if it isn't `MAIL_DOMAIN`, then change the MX record (and SPF, DKIM, autodiscover) to the suite (see [Mail](#mail)).
4. Wait until new mail arrives in the suite (send a test from outside), then choose **Copy** again for everyone (or **Sync changes** on each copy): only what changed since the last copy comes across (new and moved mail, read and flag changes, new, edited, renamed and deleted files, calendar, contact and task changes).
5. Tell people to sign in to the suite, and to set up phones and desktop clients against it.
6. Keep the Microsoft 365 tenant read-only for a while, run one last sync a day or two later for stragglers, then remove the source and delete the Entra app registration.

### Other IMAP servers

**Another IMAP server** copies mail from anything with IMAP (Google Workspace, another host, an old on-premises server): give the server, then each mailbox's login and password (an app password for accounts with two-step sign-in) and the suite account it moves into. Folders, read and flag state and dates come across; a re-run copies new mail and flag changes. Servers on a private network are refused unless `MIGRATION_ALLOW_PRIVATE_HOSTS=1`.

### What is not copied

Teams chats and channel messages, OneNote notebooks (listed as skipped), Planner plans, mailbox rules, signatures and automatic replies, shared and group mailboxes (copy one as a user), and sharing on individual OneDrive files. Recurring meetings arrive as their single occurrences; each series' pattern is kept with the migration so it can be brought across as a series later. To Do repeats that Synergy has no match for (every two weeks, say) arrive without the repeat. Contacts from other contact folders arrive in the main list. Files keep their original date; the copy's author is the person (or, for libraries, the admin).

## Insights

`insights.<domain>` is the Power BI equivalent. Its report designer and charts are [Metabase](https://github.com/metabase/metabase), the open source edition (AGPL) from the official `metabase/metabase` image, unmodified, served at `insights.<domain>/studio` behind the suite sign-in.

- Set `INSIGHTS_SECRET` (`openssl rand -hex 32`; the quickstart writes one) and keep it: Insights derives every Metabase password and key from it. On first start Insights runs Metabase's setup with its own service account, so don't finish Metabase's setup wizard by hand.
- Nobody signs in to Metabase separately. When someone opens the designer, Insights makes their Metabase account and opens a session for them; the gateway checks on every designer request that the Metabase session belongs to whoever is signed in to the suite.
- The sources are the suite's own databases (`INSIGHTS_SOURCES`, default Books, CRM, Desk, Base, Planner, Forms and Trust). Insights reads them as a read-only Postgres role, `insights_reader`, that can't write and can't see columns named like passwords, tokens, keys, hashes, PINs or encrypted values. It re-checks every table at start and every `INSIGHTS_SYNC_MINUTES`; admins can also sync from Data sources.
- Roles: `INSIGHTS_ADMIN_EMAILS` (default `ADMIN_EMAILS`, else `SEED_ADMIN_EMAIL`) are Metabase admins; `INSIGHTS_ANALYST_EMAILS` (or `*`) can write their own queries; everyone else views the dashboards they can open. Fine-grained permissions are in the designer's admin settings.
- Insights sets up an "Executive overview" dashboard (revenue, cash, money owed, bills, pipeline, support cases and overdue tasks from Books, CRM, Desk and Planner) on every sync, in an "Executive" collection only admins can open until an admin shares it. It replaces the old Executive View; link to `insights.<domain>/executive`.
- Dashboards appear inside Insights through Metabase's static embedding, signed by Insights only for people Metabase lets open them. The "Powered by Metabase" credit stays, as the open source edition requires. Metabase's paid features (white-labeling, SSO, interactive embedding, row-level permissions) are not used.
- Metabase needs about 1 GB of memory (`INSIGHTS_JAVA_OPTS`, default `-Xmx1g`) and takes a minute or two to start. Its own data (questions, dashboards, settings) is in the `metabase` database; back it up with the rest of Postgres.
