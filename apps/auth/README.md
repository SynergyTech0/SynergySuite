# SynergyAuth

Standalone single sign-on (SSO) server with MFA for the Synergy platform — an
OpenID Connect + SAML identity provider modeled on Keycloak/Auth0/Authentik
patterns, running on Next.js with SynergyDB storage.

## What it does

- **OIDC provider**: discovery, JWKS (RS256), authorization code flow with PKCE,
  refresh tokens, client_credentials, userinfo, introspection (RFC 7662),
  revocation (RFC 7009), RP-initiated logout.
- **SAML 2.0 IdP**: metadata at `/api/saml/metadata`, HTTP-Redirect binding in,
  signed HTTP-POST responses out (self-signed 10-year cert, generated on first
  use). Register SPs (entity ID + ACS URL) in the admin Settings tab.
- **MFA**: TOTP (QR enrollment, 10 one-time backup codes) plus a first-party
  **Synergy Authenticator** so users don't need a third-party app. TOTP engine
  ported from SynergyEMR's HIPAA MFA service; still works with Google
  Authenticator/1Password/Authy too.
- **Synergy Authenticator** (`/authenticator`): an installable, offline-capable
  PWA that generates codes entirely on-device (Web Crypto, secret never leaves
  the browser), stores accounts in local storage, and adds them by QR scan
  (BarcodeDetector), manual key entry, or a one-tap "Add to Synergy Authenticator"
  link from the enrollment screen. Standard TOTP under the hood, so the codes it
  produces are exactly the ones SynergyAuth verifies.
- **Passkeys (WebAuthn)**: usernameless "Sign in with a passkey" on the hosted
  login page (Windows Hello / Touch ID / security keys); manage passkeys in
  `/account`. A passkey assertion counts as fully authenticated (MFA-grade).
- **SCIM 2.0 provisioning**: `/api/scim/v2/Users` (create, filter, get, PUT,
  PATCH active/password, DELETE = deactivate) for Okta/Entra directory sync.
  Bearer tokens minted in the admin Settings tab, shown once.
- **Email flows**: forgot/reset password with 30-minute single-use tokens, no
  account enumeration, session + lockout reset on success. SMTP via
  `SMTP_HOST`/`SMTP_PORT` (default 127.0.0.1:8025); falls back to `./dev-mail/`
  .eml files when SMTP is unreachable.
- **Key rotation**: one click in admin Settings. New key signs, old keys stay
  in the JWKS so outstanding tokens verify until natural expiry.
- **SSO sessions**: 30-day cookie at the IdP; sign in once, every registered app
  gets silent auth. MFA-gated: `authorize` never releases a code to a session
  that hasn't completed TOTP.
- **Security defaults**: bcrypt(12) passwords, 12+ char policy, lockout after
  5 failures (15 min), one-time 120 s auth codes, rotating refresh tokens with
  reuse detection (reuse revokes the whole token family), consent skipping for
  first-party clients only, full audit log.
- **Secrets at rest**: TOTP shared secrets and the OIDC/SAML signing private keys
  are AES-256-GCM encrypted in the database (`lib/crypto.ts`, key from
  `SA_ENCRYPTION_KEY`). Plaintext rows written before encryption was enabled are
  migrated in place on first read. Password hashes, backup codes, and tokens stay
  one-way hashed.
- **SAML Single Logout** (SP-initiated, HTTP-Redirect) at `/api/saml/slo`,
  advertised in IdP metadata; degrades to local logout if the SP has no SLO URL.
- **Security headers** on every response (middleware): strict CSP with
  `frame-ancestors 'none'` + `X-Frame-Options: DENY` (blocks consent-screen
  clickjacking), `nosniff`, `no-referrer`, `Permissions-Policy`, and HSTS in prod.
- **Production guards**: fail-closed at startup if `NODE_ENV=production` and
  `ISSUER_URL` is missing/http/localhost, or `SA_ENCRYPTION_KEY` is unset
  (skipped during `next build`, enforced when serving).
- **Device compliance (conditional access)**: with Devices connected, sign-in
  (OIDC authorize, SAML SSO) and session renewal (refresh grant) are refused
  while one of the person's devices fails its compliance policies; they land on
  `/login/device-blocked`, which lists each device and what to fix. Off,
  report-only or block, an exempt list, and whether people with no device may
  sign in are set in `/admin` → Settings. Fails open, audited, if Devices is down.
- **The suite's AI model**: `/admin` → Settings → AI model picks the provider
  (Anthropic (Claude), OpenAI, an OpenAI-compatible server or Ollama), model,
  base URL, API key and optional embedding and speech models for every app.
  The key is encrypted with `SA_ENCRYPTION_KEY` and never shown again (only its
  last 4); Test makes one small real request; changes are audited without the
  key. Apps read it from `GET /api/internal/ai-settings` with
  `PROXY_SHARED_SECRET` (`@synergy/ai`), falling back to their `AI_*` settings.
- **Hosted pages**: `/login`, `/login/mfa`, `/consent`, `/forgot`, `/reset`,
  `/account` (MFA, passkeys, password, sessions), `/admin` (users, clients,
  audit, settings).

## Run

```
npm install
npm run dev          # port 3500
npm run seed         # prints admin password + demo client (once)
```

Storage: SynergyDB at `postgres://…:5499/synergydb`, tables prefixed `sa_`
(see `lib/db.ts` for the SynergyDB wire quirks this layer works around).

## Verify

```
E2E_ADMIN_PASSWORD=<seed password> npm run e2e
```

71 checks covering login, lockout, MFA enroll/login, backup-code reuse, PKCE
happy/attack paths, code replay, refresh rotation + family revocation,
introspection, revocation, client_credentials, logout, password reset (token
single-use, enumeration resistance), key rotation (old tokens still verify),
a full WebAuthn ceremony against a software P-256 authenticator (including
assertion replay rejection), SCIM CRUD, and a SAML round-trip where the test
acts as the SP and validates the response signature against the IdP metadata.
With `E2E_DEVICES_PORT` and `E2E_DEVICES_TOKEN` set (and the server started with
`DEVICES_INTERNAL_URL=http://localhost:<port>` and `DEVICES_SVC_TOKEN=<token>`),
the test also plays Devices and checks device compliance at sign-in. It also
checks the AI model setting (start the server and the test with the same
`PROXY_SHARED_SECRET` to include the internal endpoint's answer).

## Wire up an app (any OIDC client library)

1. `/admin` → Clients → Register (first-party = skip consent; public = PKCE).
2. Configure the app:
   - Issuer / discovery: `http://localhost:3500/.well-known/openid-configuration`
   - `client_id` / `client_secret` from step 1
   - Redirect URI must exactly match a registered one.
3. For APIs: validate the RS256 access token against `/api/oidc/jwks`, or call
   `/api/oidc/introspect` with client credentials.

Works with `next-auth` (OIDC provider), `openid-client`, Spring, etc.

## Configuration

| Env | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | yes | SynergyDB (Postgres wire), default `…:5499/synergydb` |
| `ISSUER_URL` | prod | Public https origin; drives OIDC issuer, WebAuthn origin, reset links |
| `SA_ENCRYPTION_KEY` | prod | 32-byte hex/base64 key for secrets-at-rest (dev auto-generates `.sa-dev-key`) |
| `SA_RP_ID` | no | WebAuthn Relying Party ID; defaults to `ISSUER_URL` host |
| `PROXY_SHARED_SECRET` | no | The suite's shared secret: other apps present it to check app passwords and read the AI model settings |
| `DEVICES_INTERNAL_URL`/`DEVICES_SVC_TOKEN` | no | Devices' internal address and service token, for device compliance at sign-in |
| `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM` | no | Password-reset email (dev falls back to `./dev-mail/*.eml`) |

## Notes / not yet done

- Set `SA_RP_ID` to the real registrable domain **before** enrolling real
  passkeys — passkeys are bound to the RP ID, so ones enrolled on localhost
  won't carry over to a production domain (expected WebAuthn behavior).
- SAML: signed Response/Assertion + SP-initiated SLO. No encrypted assertions,
  no IdP-initiated SLO.
- SCIM: Users resource only (no Groups), filter limited to `userName eq`.
- `lib/db.ts` inlines integer params as literals to defend against a SynergyDB
  bigint-param bug; harmless now that the engine is fixed, kept for portability.
