# Synergy Phone

Synergy's answer to Teams Phone: calls between colleagues in the browser, real phone numbers through any SIP provider or office phone system, voicemail, and call history. Calls ring on any Synergy page, not only in Phone.

- **Calling**: by name, email or number, with suggestions from the people in Phone; a keypad for menus (DTMF); mute, hold, add someone, transfer, and **Meet** to turn the call into a Meet meeting with video and screen sharing, without hanging up.
- **Phone numbers**: an admin adds a SIP trunk (a phone company such as Telnyx, Twilio, Vonage or a local carrier, or an office PBX such as Asterisk, FreeSWITCH or 3CX), its numbers, and who has each one. Calls in ring that person; calls out show their number.
- **Voicemail**: a spoken or recorded greeting, the message saved as audio, transcribed by your own speech model, with unheard counts and notifications.
- **Settings for each person**: do not disturb, forward to a colleague or a number, ring a mobile at the same time, how long to ring before voicemail.
- **Chat and Meet**: a Call button in direct messages, and in a Meet meeting hosts can call a phone number in.
- **Compliance and search**: call records and voicemail in eDiscovery (holds and retention included), and in suite search for each person.

## How it works

Phone runs on the same LiveKit media server as Meet. A call is a LiveKit room: people join from the browser with their email as identity, and phone numbers join through **LiveKit SIP**, which sits next to the media server and speaks SIP to your trunk. LiveKit's webhooks tell Phone who joined and left; Phone keeps call state in Postgres and pushes ringing to browsers over server-sent events. Ringback, the voicemail greeting, the beep and the recording are done by a small worker inside the Phone server that joins the call as `phone-agent` (LiveKit's Node SDK). Default greetings are spoken by eSpeak NG.

Calls between colleagues need only the media server. Real phone numbers also need the SIP service.

## Setting it up

1. **Database**: new installs get a `phone` database from `deploy/postgres-init.sql`. On an existing install, create it once: `docker compose exec postgres psql -U postgres -c "CREATE DATABASE phone"`.
2. **Media server webhook** (required): in Meet's `livekit.yaml`, uncomment the `webhook` section (see `apps/meet/deploy/livekit.template.yaml`) so it points at `https://phone.<your domain>/api/livekit/webhook`, and restart LiveKit. Without it calls ring but never connect their state.
3. **Admins**: `PHONE_ADMIN_EMAILS` (defaults to `ADMIN_EMAILS`) can open Phone admin.
4. **Real phone numbers** (optional):
   - Uncomment `redis` in `livekit.yaml` too.
   - Copy `deploy/sip.template.yaml` to `sip.yaml` next to `deploy/docker-compose.sip.yml`, fill in the media server's key and secret, and run `docker compose -f docker-compose.sip.yml up -d` on the media server's host.
   - Open UDP and TCP 5060 (SIP) and UDP 10000 to 20000 (call audio) to your provider.
   - In Phone admin, add a trunk with your provider's SIP address and login, the provider's IP ranges for calls in, then its numbers, and give each number to a person.
   - At the provider, send each number's calls to `PHONE_SIP_HOST` (default `sip.<your domain>`, pointing at the media server's host) on port 5060.
5. **Calling phones into meetings** (optional): set the same `PHONE_SVC_TOKEN` (`openssl rand -hex 32`) for Meet and Phone.
6. **Voicemail transcripts** (optional): set `PHONE_AI_SPEECH_MODEL` or the suite-wide `AI_SPEECH_MODEL` (see `@synergy/ai`).

## Settings

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Phone's Postgres database |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The media server's keys, the same as Meet's |
| `LIVEKIT_API_URL` | The media server's API (default `https://meet.<SUITE_DOMAIN>`) |
| `NEXT_PUBLIC_LIVEKIT_URL` | Where browsers connect (default: the API URL as `wss://`) |
| `TURN_HOST`, `TURN_STATIC_SECRET` | TURN for people behind strict firewalls, as in Meet |
| `PHONE_ADMIN_EMAILS` | Who can manage trunks and numbers (default `ADMIN_EMAILS`) |
| `PHONE_COUNTRY_CODE` | Added to numbers typed without a country code (default `1`) |
| `PHONE_SIP_HOST` | The SIP address shown in Phone admin (default `sip.<SUITE_DOMAIN>`) |
| `PHONE_SVC_TOKEN` | Shared with Meet so hosts can call phones into meetings |
| `PHONE_VOICEMAIL_MAX_SECONDS` | Longest voicemail message (default 180) |
| `PHONE_TTS_BIN`, `PHONE_TTS_VOICE` | The speech program and voice for spoken greetings (default `espeak-ng`, `en-us`) |
| `PHONE_WORKER` | `0` turns off the voicemail and ringback worker in this server |
| `PHONE_AI_SPEECH_MODEL` | Speech-to-text model for voicemail transcripts |

## Development

```
npm run dev --workspace apps/phone   # http://localhost:3440, DEV_USER_EMAIL signs you in
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5499/phone_test npm test --workspace apps/phone
```

For real calls locally, run `livekit-server --dev` with a `webhook` pointing at `http://localhost:3440/api/livekit/webhook` and set `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `LIVEKIT_API_URL=http://localhost:7880`.

## Built on

Synergy Phone wraps these open source projects, with thanks to their authors:

- [LiveKit](https://github.com/livekit/livekit) media server and [LiveKit SIP](https://github.com/livekit/sip), Apache-2.0
- [LiveKit Node SDKs](https://github.com/livekit/node-sdks) and [client SDK](https://github.com/livekit/client-sdk-js), Apache-2.0
- [Valkey](https://github.com/valkey-io/valkey), BSD-3-Clause
- [eSpeak NG](https://github.com/espeak-ng/espeak-ng), GPL-3.0, run as a separate program
