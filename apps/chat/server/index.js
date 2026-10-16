const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');
const api = require('./api');
const hub = require('./ws');
const compliance = require('./compliance');

const { identify, optionsFromEnv } = require('@synergy/identity');
const { baseApp, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');

const PORT = portFor('chat');
const identityOptions = optionsFromEnv();

// Identity comes from oauth2-proxy, which owns these headers end-to-end.
// In dev (DEV_USER_EMAIL set), an x-dev-user header or ?as= query simulates users per tab.
// Shared by the HTTP API and the WebSocket upgrade, which Express middleware doesn't see.
function identifyRequest(req) {
  const as = new URL(req.url, 'http://x').searchParams.get('as');
  return identify(req.headers, { ...identityOptions, devOverride: as });
}

async function main() {
  await db.migrate();

  const app = express();
  baseApp(app, express);

  // Admin center over the internal network: COMPLIANCE_TOKEN instead of the gateway identity.
  app.use('/api/compliance', compliance.router);

  app.use('/api', async (req, res, next) => {
    try {
      const ident = identifyRequest(req);
      if (!ident) return res.status(401).json({ error: 'unauthenticated' });
      req.user = await db.upsertUser(ident.email, ident.name);
      next();
    } catch (e) { next(e); }
  });
  app.use('/api', api);

  app.use(errorHandler('chat'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'chat' });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    try {
      if (!req.url.startsWith('/ws')) return socket.destroy();
      const ident = identifyRequest(req);
      if (!ident) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return socket.destroy();
      }
      const user = await db.upsertUser(ident.email, ident.name);
      wss.handleUpgrade(req, socket, head, ws => hub.addClient(ws, user));
    } catch (e) {
      console.error('upgrade error', e);
      socket.destroy();
    }
  });

  server.listen(PORT, () => console.log(`SynergyChat listening on :${PORT}`));
  compliance.startRetentionSweep();
}

main().catch(e => { console.error(e); process.exit(1); });
