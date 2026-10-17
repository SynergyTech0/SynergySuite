# Sign

E-signatures for SynergySuite (the DocuSign equivalent): upload a PDF or start from a template, place fields, send it to one or more signers (in order or all at once), and get back the signed PDF with an audit trail.

Status: early. It runs as an add-on behind the suite gateway on port 3300 (`sign.<domain>`).

## Who signs in

- **People in the suite** sign in with their suite account. The gateway passes who they are in headers and `lib/auth.ts` reads them with `@synergy/identity`; Sign has no login or sign-up of its own. A Sign account from before is matched by email, and someone new gets one the first time they open Sign. `SIGN_ADMIN_EMAILS` get the admin pages.
- **Signers** are often outside the organization. They open `/sign/<token>` from their email and need no account. The gateway lets those pages, `/api/signers/*` and `/api/files/*` through without a session; the token (or a signed, expiring file link) is the only key, and `lib/access.ts` checks it on every request, including signing order and whether that signer already finished.

## Running it

In the suite, `deploy/compose.yml` runs it from `deploy/sign.Dockerfile` with its own `sign` database and a `sign-files` volume; see the Sign section of `deploy/README.md` for its settings.

For development, outside Docker:

```bash
npm ci --prefix ../.. && npm run build:packages --prefix ../..   # the suite packages Sign links to
npm ci --legacy-peer-deps
cp .env.example .env    # DATABASE_URL, SSO_URL or SUITE_DOMAIN, PROXY_SHARED_SECRET
npx prisma migrate deploy
npm run dev             # http://localhost:3300
```

Without a gateway in front, send the identity headers yourself (`x-auth-request-email`, `x-auth-request-user`, and `x-proxy-auth-secret` when `PROXY_SHARED_SECRET` is set).

Checks: `npm run typecheck`, `npm test` and `npm run build`.

## Mail

Signing requests, reminders and completed documents go out from the suite mailbox `sign@<MAIL_DOMAIN>` through Stalwart (`MAIL_*`, set by compose), or through one outside mailbox with `SIGN_SMTP_HOST`, `SIGN_SMTP_USER` and `SIGN_SMTP_PASSWORD`. With neither, each message is written to `SIGN_DEV_MAIL_DIR` (default `./dev-mail`) instead of being sent, so the flow can still be tried.

## Files

`STORAGE_MODE=local` keeps documents under `LOCAL_STORAGE_PATH`; `STORAGE_MODE=s3` uses `AWS_*` (and `AWS_ENDPOINT_URL` for an S3-compatible store). Downloads go through `/api/files/*`, which serves a file to its owner or through a link signed with `SIGN_LINK_SECRET`.

## AI

Field detection goes through `@synergy/ai`: `SIGN_AI_PROVIDER`, `SIGN_AI_BASE_URL`, `SIGN_AI_API_KEY` and `SIGN_AI_MODEL`, else the suite's `AI_*`. It needs a model that reads images.

## Suite features

- The suite header (`components/suite/SuiteBar.tsx`).
- Suite search: `POST /api/search` finds documents you sent or were asked to sign.
- Admin center: `POST /api/compliance/search` and `/api/compliance/export` (eDiscovery), and a document whose sender or signer is on legal hold is kept, not deleted (`lib/ediscovery.ts`).

## Not done

- The Android app in `android-app/` used the removed mobile login and does not work with the suite.
- Billing, affiliate and enterprise-invitation pages come from the hosted product; billing is hidden unless `SIGN_BILLING=1`, and none of it is wired to the suite.

## License

AGPL-3.0, as the rest of SynergySuite.
