# SynergyChat

Team messaging for the Synergy suite. Channels (public/private), DMs, threads,
reactions, @mentions, unread counts, presence, typing indicators, search — all
real-time over WebSocket.

- **Server:** Node 22 + Express + ws + Postgres (no ORM), `server/`
- **Web:** React 18 + Vite, `web/`
- **Auth:** the suite gateway (Caddy + oauth2-proxy against SynergyAuth) sets the
  signed-in user's headers; `@synergy/identity` reads them and checks
  `PROXY_SHARED_SECRET` so the app can't be reached around the gateway.

## Local dev

```powershell
docker run -d --name schat-dev-pg -e POSTGRES_USER=chat -e POSTGRES_PASSWORD=chat `
  -e POSTGRES_DB=synergychat -p 5470:5432 postgres:16-alpine
npm install                     # from the repository root
npm run build:packages          # from the repository root
cd apps/chat/web; npm install; npm run build; cd ..
$env:DATABASE_URL='postgres://chat:chat@127.0.0.1:5470/synergychat'
$env:DEV_USER_EMAIL='you@example.com'; node server/index.js
# open http://localhost:3080  (use ?as=other@example.com to simulate a second user)
```

Vite dev server with HMR: `cd web; npm run dev` (proxies /api + /ws to :3080).

## Production

Deployed with the rest of the suite; see `deploy/README.md` at the repository root.
