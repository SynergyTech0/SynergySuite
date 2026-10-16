# Mail (Outlook equivalent)

The suite's web mailbox: folders, a reading pane, search, flags, move, archive, junk, delete, attachments, and a rich-text composer with reply, reply all and forward.

- **Suite mailbox.** Each signed-in user's own mailbox on the suite's mail server (Stalwart in `deploy/compose.yml`). Mail opens it with a service login allowed to open any mailbox, so nobody types a mail password, and creates it the first time the user visits.
- **Outside accounts.** Users can add any IMAP/SMTP account (Gmail, Outlook.com, Yahoo, iCloud have presets). Passwords are encrypted with `MAIL_ENCRYPTION_KEY` before they are stored. Servers on private addresses and non-mail ports are refused, and TLS is required.
- **Safe reading.** Message HTML is sanitized and shown in a sandboxed frame with no scripts. Remote images are blocked until the user asks for them, so senders can't track opens.

- **Legal hold and eDiscovery.** For everyone the Admin center puts on hold, a background sweep copies every message in every folder into a preserved store in Postgres, every few minutes and within a minute of a new hold, fetching only new mail on later passes. Desktop and phone clients delete straight from the mail server, so this can't rely on catching deletes; Mail's own delete also copies first. The Admin center searches and exports through `POST /api/compliance/search` and `/export`: live mailboxes (opened with the master login) plus the store, where mail found only in the store comes back as deleted. Outside accounts are not covered.

IMAP is the source of truth; Postgres holds the list of outside accounts and the preserved copies of mail on hold.

## Run it locally

```
npm install
docker run -d --name greenmail -p 3025:3025 -p 3143:3143 greenmail/standalone   # a throwaway test mail server
cd apps/mail
DEV_USER_EMAIL=alice@example.test MAIL_IMAP_HOST=127.0.0.1 MAIL_IMAP_PORT=3143 MAIL_IMAP_SECURE=false \
MAIL_SMTP_HOST=127.0.0.1 MAIL_SMTP_PORT=3025 MAIL_SMTP_SECURE=false \
MAIL_SUITE_AUTH=shared-password MAIL_DEV_PASSWORD=alice MAIL_ALLOW_PRIVATE_HOSTS=1 npm run dev
```

`npm test` runs the unit tests (sanitizer, secret sealing, outside-server checks, eDiscovery query translation and ids). With `TEST_DATABASE_URL` set it also runs the legal hold tests against that Postgres, with an in-memory stand-in for the mail server.

## Settings

| Variable | Meaning |
|---|---|
| `MAIL_IMAP_HOST` / `_PORT` / `_SECURE` | Suite mail server for reading (default port 993, implicit TLS). Unset to offer outside accounts only. |
| `MAIL_SMTP_HOST` / `_PORT` / `_SECURE` | Suite mail server for sending (default port 465, implicit TLS). |
| `MAIL_SUITE_TLS_INSECURE` | Accept the suite mail server's self-signed certificate. |
| `MAIL_SUITE_AUTH` | `master` (production) or `shared-password` (development only). |
| `MAIL_MASTER_USER` / `MAIL_MASTER_PASSWORD` | The service login. `MAIL_MASTER_LOGIN` shapes the login sent, default `{user}%{master}` (Stalwart). |
| `MAIL_ADMIN_URL` / `_USER` / `_PASSWORD` | Stalwart's admin API, used to create mailboxes on first visit. Leave unset if you create them yourself. |
| `MAIL_ENCRYPTION_KEY` | Key for outside-account passwords. Required in production. |
| `MAIL_ALLOW_PRIVATE_HOSTS=1` | Development only: lets outside accounts point at local test servers. |
| `ADMIN_INTERNAL_URL` / `COMPLIANCE_TOKEN` | The Admin center, asked who is on legal hold, and the token it uses for eDiscovery calls. Without `ADMIN_INTERNAL_URL` nobody is on hold. |
| `MAIL_PRESERVE_INTERVAL_MINUTES` | How often the hold sweep copies new mail of people on hold (default 5). New holds are picked up within a minute. |
| `MAIL_COMPLIANCE_PREFILTER=imap` | Faster eDiscovery: narrow with IMAP `SEARCH TEXT` before matching exactly. Off by default because Stalwart's word-based search misses parts of words, unaccented spellings and attachment names; by default every message in the date range is checked, so nothing is missed. |
