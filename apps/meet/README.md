# Meet (Teams meetings equivalent)

Video meetings for the suite on [LiveKit](https://livekit.io): instant rooms, scheduled meetings with email invitations (`.ics` files that Outlook, Gmail and Apple Calendar treat as real invites), guest links for people outside the company, breakout rooms, host moderation, recording, and live transcripts and captions from a self-hosted worker. With [Phone](../phone/README.md), hosts can call phone numbers into a meeting, and a phone call can be opened as a meeting without hanging up.

- **App:** Next.js 15 + React 19 (port 3420). Scheduled meetings and their invitees are kept in Postgres; everything else lives in LiveKit.
- **Who can join:** staff are signed in by the suite gateway (`@synergy/identity`), and Meet never runs its own login. Guests never sign in; they join an existing room under a name they type.
- **Media:** the LiveKit server, its recording service and an optional TURN relay run separately (`deploy/`); `moat/` is an optional worker that transcribes and summarises recordings into Drive and Planner.

## Run it locally

You need Node 22, Postgres and a LiveKit server. LiveKit's dev mode is the quickest: install [`livekit-server`](https://docs.livekit.io/home/self-hosting/local/) and run `livekit-server --dev`, which listens on port 7880 with the key `devkey` and secret `secret`.

```
docker run -d --name meet-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
npm install && npm run build:packages            # from the repository root
cd apps/meet

export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/postgres
export DEV_USER_EMAIL=you@example.com
export LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret
export LIVEKIT_API_URL=http://localhost:7880 NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
npm run dev                                      # http://localhost:3420
```

The meetings table is created on first use. Invitations are only emailed when the SMTP settings below are set; without them, scheduling still works and the invite link can be copied from the app.

`npm test` runs the unit tests and `npx tsc --noEmit -p apps/meet` (from the repository root) typechecks the app, as CI does.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string for scheduled meetings. |
| `DEV_USER_EMAIL` | Signs every request in as this user when there is no gateway. Ignored when `NODE_ENV=production`. |
| `SUITE_DOMAIN` | The suite's domain. Used for sign-in and sign-out links, the suite header, and the defaults below. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit API credentials; must match the LiveKit server's keys. |
| `LIVEKIT_API_URL` | LiveKit's HTTP API, used for breakouts, moderation and recording (default `https://meet.<SUITE_DOMAIN>`). |
| `LIVEKIT_WS_URL` / `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit's WebSocket URL that browsers connect to, read at run time (default `wss://meet.<SUITE_DOMAIN>`, which the gateway passes to LiveKit). |
| `MEET_PUBLIC_URL` | Base URL used in invitation links (default `https://meet.<SUITE_DOMAIN>`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Mail server for invitations. Port defaults to 465; `SMTP_FROM` defaults to `SMTP_USER`. No email is sent unless host, user and password are set, or when `DEMO_MODE=1`. |
| `TURN_HOST` / `TURN_STATIC_SECRET` | Optional TURN relay for people behind strict firewalls. Give it a different public IP from the LiveKit server. |
| `CAPTIONS_WORKER_URL` | The transcription and captions worker (default `http://host.docker.internal:9081`). |
| `PHONE_SVC_TOKEN` | Shared with Synergy Phone. When set, hosts can call a phone number into a meeting from the People panel; the call goes out from their own number. |
| `PHONE_INTERNAL_URL` | Where Meet reaches Phone (default `http://phone:3440` in production). |
| `PROXY_SHARED_SECRET` | Shared secret the gateway sends, so the app can't be reached around it. |

## Production

The app is the `meet` service in `deploy/compose.yml`; see [deploy/README.md](../../deploy/README.md). The LiveKit server is the `livekit` service in the same file, so meetings work from `deploy/quickstart.sh` with nothing else to run (see Meet and Phone media in the deploy README). Recording still needs LiveKit Egress and Redis, which are not in the main compose file yet: run `deploy/docker-compose.egress.yml` here next to your own media server. `deploy/docker-compose.yml` here remains for running LiveKit on its own host with host networking; point `LIVEKIT_UPSTREAM` at it.
