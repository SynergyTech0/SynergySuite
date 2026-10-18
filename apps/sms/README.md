# Synergy SMS

Two-way business texting on the suite's shared packages.

- **Inbox.** Conversations by number, newest first, with unread counts. Open one to read and reply; it refreshes every few seconds.
- **Contacts** with names and tags, added by hand or imported from CSV (number, name, tags). Numbers are kept as E.164; ones typed without a country code get `SMS_DEFAULT_COUNTRY_CODE` (default 1).
- **Campaigns** text every contact, or everyone with one tag, one a second in the background. Each recipient is queued in the database first, so a restart carries on where sending stopped.
- **Opt-outs.** A contact who texts STOP (or STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) is opted out and never texted again, campaigns included, until they text START. Opt-outs can also be set by hand.
- **Provider.** `SMS_PROVIDER` picks the texting service; Twilio is the only one so far (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`). Without one, SMS shows what it has but sends nothing.
- **Webhooks.** Point the Twilio number's "A message comes in" webhook at `https://sms.<domain>/api/webhooks/twilio/inbound` (HTTP POST). Delivery updates come back to `/api/webhooks/twilio/status`, which each send asks for. These paths skip suite sign-in, so every request must carry a valid `X-Twilio-Signature` for `TWILIO_AUTH_TOKEN`; anything else gets 403. Twilio signs the exact public URL: set `SMS_PUBLIC_URL` when it isn't `https://sms.<SUITE_DOMAIN>`.
- **Access.** Texts cost money, so only `SMS_ALLOWED_EMAILS` (else `ADMIN_EMAILS`) can use SMS. With neither set, nobody can.
- **Suite search** (`POST /api/search`) finds contacts and texts.

Port 3920, database `sms`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/sms`.
