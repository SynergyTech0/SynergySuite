# Mail (Outlook equivalent)

The suite's web mailbox: folders, a reading pane, search, flags, move, archive, junk, delete, attachments, and a rich-text composer with reply, reply all and forward.

- **Suite mailbox.** Each signed-in user's own mailbox on the suite's mail server (Stalwart in `deploy/compose.yml`). Mail opens it with a service login allowed to open any mailbox, so nobody types a mail password, and creates it the first time the user visits.
- **Shared mailboxes and distribution lists.** The Groups app keeps them on the mail server through `PUT`/`DELETE /api/svc/groups/<address>` (server to server with `PROXY_SHARED_SECRET`; the gateway never forwards `/api/svc/`). `kind: "list"` makes a Stalwart mailing list whose recipients are exactly the members (outside addresses allowed); `kind: "shared"` makes a group account and gives each member it (members need an address on a domain the mail server hosts; others come back in `skipped`). Mail remembers who it added in Postgres, so a new member list takes away exactly the rest. Needs `MAIL_ADMIN_URL`; without it the answer is `provisioned: false`. Each shared mailbox or team mailbox a person belongs to (asked of Groups, `GROUPS_INTERNAL_URL`) appears as an extra account: it opens their own suite login scoped to `Shared Folders/<address>/` and sends from the shared address under its name.
- **Outside accounts.** Users can add any IMAP/SMTP account (Gmail, Yahoo, iCloud have presets; GoDaddy Workspace Email is recognised from the domain's MX records). Microsoft 365 accounts, including Microsoft 365 from GoDaddy, and Outlook.com no longer take passwords over IMAP/SMTP, so Mail spots them from the address (MX on `*.mail.protection.outlook.com`) and offers **Sign in with Microsoft**: the same OAuth2 sign-in Thunderbird uses, then IMAP (`outlook.office365.com:993`) and SMTP (`smtp.office365.com:587`) with XOAUTH2. The refresh token is stored encrypted like a password and access tokens are kept in memory only; signing in again to the same address renews it. Passwords are encrypted with `MAIL_ENCRYPTION_KEY` before they are stored. Servers on private addresses and non-mail ports are refused, and TLS is required.
- **Company Microsoft 365 mailboxes through Microsoft Graph.** With an organization's own app registration (application permissions `Mail.ReadWrite` and `Mail.Send`, admin consent granted), everyone who signs in to the suite with an address on `MAIL_GRAPH_DOMAINS` sees their Microsoft 365 mailbox, with no sign-in, MFA prompt or IMAP needed. `MAIL_GRAPH_MAILBOXES` gives named people extra mailboxes (`suite user=mailbox`, comma separated). Reading, flags, moves, folders, search (Microsoft's own) and sending (Exchange files it in Sent Items) work as for other accounts; deleting keeps a copy first for people on legal hold. The background hold sweep, eDiscovery and suite search don't cover these mailboxes yet: use Microsoft Purview for those. The app can open every mailbox in its organization, so its secret belongs only in the server's settings.
- **Safe reading.** Message HTML is sanitized and shown in a sandboxed frame with no scripts. Remote images are blocked until the user asks for them, so senders can't track opens.

- **Legal hold and eDiscovery.** For everyone the Admin center puts on hold, a background sweep copies every message in every folder of their suite mailbox and of every outside IMAP account they connected to Mail into a preserved store in Postgres, every few minutes and within a minute of a new hold, fetching only new mail on later passes. Desktop and phone clients delete straight from the mail server, so this can't rely on catching deletes; Mail's own delete also copies first, in outside accounts too, and removing an outside account takes one last copy first. The Admin center searches and exports through `POST /api/compliance/search` and `/export`: live mailboxes (the suite mailbox opened with the master login, outside accounts with the password the person saved) plus the store, where mail found only in the store comes back as deleted. Hits from an outside account belong to the custodian, and the export names the account. An outside account that no longer signs in (a revoked or changed password) or that the person removed is searched in the store only, with a note saying so.
- **Sensitivity labels.** The composer offers the suite's labels from the Admin center, starting on the organization's default; replies and forwards keep the original's. A label is written as the `msip_labels` header Outlook uses, its marking (e.g. CONFIDENTIAL) is added at the end of the message, and a label that blocks outside sharing refuses recipients outside the organization's domains. Received mail with a known label shows it in the reading pane.
- **Data loss prevention.** Before sending, the subject, body and text attachments are checked against the Admin center's DLP rules for every recipient. A block rule stops the message, a warn rule asks for a reason before it goes, and every match is reported to the Admin center.

IMAP is the source of truth; Postgres holds the list of outside accounts, the preserved copies of mail on hold, and who was added to each shared mailbox.

## Run it locally

```
npm install
docker run -d --name greenmail -p 3025:3025 -p 3143:3143 greenmail/standalone   # a throwaway test mail server
cd apps/mail
DEV_USER_EMAIL=alice@example.test MAIL_IMAP_HOST=127.0.0.1 MAIL_IMAP_PORT=3143 MAIL_IMAP_SECURE=false \
MAIL_SMTP_HOST=127.0.0.1 MAIL_SMTP_PORT=3025 MAIL_SMTP_SECURE=false \
MAIL_SUITE_AUTH=shared-password MAIL_DEV_PASSWORD=alice MAIL_ALLOW_PRIVATE_HOSTS=1 npm run dev
```

`npm test` runs the unit tests (sanitizer, secret sealing, outside-server checks, eDiscovery query translation and ids, DLP and label handling on send, the Stalwart calls for groups against a stand-in admin API, shared mailbox access and folder mapping). With `TEST_DATABASE_URL` set it also runs the legal hold tests against that Postgres, with an in-memory stand-in for the mail server.

## Settings

| Variable | Meaning |
|---|---|
| `MAIL_IMAP_HOST` / `_PORT` / `_SECURE` | Suite mail server for reading (default port 993, implicit TLS). Unset to offer outside accounts only. |
| `MAIL_SMTP_HOST` / `_PORT` / `_SECURE` | Suite mail server for sending (default port 465, implicit TLS). |
| `MAIL_SUITE_TLS_INSECURE` | Accept the suite mail server's self-signed certificate. |
| `MAIL_SUITE_AUTH` | `master` (production) or `shared-password` (development only). |
| `MAIL_MASTER_USER` / `MAIL_MASTER_PASSWORD` | The service login. `MAIL_MASTER_LOGIN` shapes the login sent, default `{user}%{master}` (Stalwart). |
| `MAIL_ADMIN_URL` / `_USER` / `_PASSWORD` | Stalwart's admin API, used to create mailboxes on first visit and to keep shared mailboxes and distribution lists. Leave unset if you create them yourself. |
| `GROUPS_INTERNAL_URL` | The Groups app, asked which shared mailboxes a person belongs to (default `http://groups:3830` in production, `http://localhost:3830` otherwise). Unreachable means no shared mailboxes are shown. |
| `MAIL_SHARED_FOLDERS` | Where the mail server shows shared mailboxes in a member's login (default `Shared Folders`, Stalwart's). |
| `MAIL_ENCRYPTION_KEY` | Key for outside-account passwords. Required in production. |
| `MAIL_MICROSOFT_CLIENT_ID` / `_CLIENT_SECRET` | The Microsoft Entra app for Sign in with Microsoft (below). Unset hides it. |
| `MAIL_MICROSOFT_TENANT` | `common` (default: any organization and Outlook.com), `organizations`, or one directory id. |
| `MAIL_PUBLIC_URL` | Where people open Mail, for the redirect URI (default `https://mail.SUITE_DOMAIN`, `http://localhost:3200` without one). |
| `MAIL_GRAPH_TENANT` / `_CLIENT_ID` / `_CLIENT_SECRET` | The organization's app for company mailboxes through Microsoft Graph (directory id or domain, client id, secret). |
| `MAIL_GRAPH_DOMAINS` | Domains whose suite users get their own address's Microsoft 365 mailbox, e.g. `company.com`. |
| `MAIL_GRAPH_MAILBOXES` | Extra mailboxes for named people: `suite user=mailbox`, comma separated. |
| `MAIL_ALLOW_PRIVATE_HOSTS=1` | Development only: lets outside accounts point at local test servers. |
| `ADMIN_INTERNAL_URL` / `COMPLIANCE_TOKEN` | The Admin center, asked who is on legal hold and for the sensitivity labels and DLP rules, and the token it uses for eDiscovery calls. Without `ADMIN_INTERNAL_URL` nobody is on hold, the default labels are offered and no DLP rules apply. |
| `MAIL_PRESERVE_INTERVAL_MINUTES` | How often the hold sweep copies new mail of people on hold (default 5). New holds are picked up within a minute. |
| `MAIL_COMPLIANCE_PREFILTER=imap` | Faster eDiscovery: narrow with IMAP `SEARCH TEXT` before matching exactly. Off by default because Stalwart's word-based search misses parts of words, unaccented spellings and attachment names; by default every message in the date range is checked, so nothing is missed. |

## Sign in with Microsoft (Microsoft 365, GoDaddy, Outlook.com)

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), App registrations, New registration. Name it (e.g. Synergy Mail). Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*. Redirect URI: platform **Web**, `https://mail.<SUITE_DOMAIN>/api/oauth/microsoft/callback` (`http://localhost:3200/api/oauth/microsoft/callback` for development).
2. API permissions, Add a permission, APIs my organization uses, **Office 365 Exchange Online**, Delegated: `IMAP.AccessAsUser.All` and `SMTP.Send`. Also Microsoft Graph, Delegated: `offline_access`, `openid`, `email`, `profile`.
3. Certificates & secrets, New client secret. Put the Application (client) ID in `MAIL_MICROSOFT_CLIENT_ID` and the secret's value in `MAIL_MICROSOFT_CLIENT_SECRET`, then restart Mail.
4. In each mailbox's organization, IMAP and Authenticated SMTP must be on for the mailbox (Microsoft 365 admin center, Users, the user, Mail, Manage email apps). If sign-in says an admin must approve the app, a global admin of that organization signs in once and accepts it for everyone, or opens `https://login.microsoftonline.com/<their domain>/adminconsent?client_id=<client id>`.

Any app registration can live in any directory: a Microsoft 365 organization from GoDaddy can use one registered in another organization, as long as its admin allows the app.

