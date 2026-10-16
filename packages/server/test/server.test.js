const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa, appBarHtml } = require('..');

async function withServer(app, fn) {
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

function makeApp() {
  const app = express();
  baseApp(app, express);
  app.get('/svc', requireBearer('tok'), (req, res) => res.json({ ok: true }));
  app.use('/api', requireUser({ identify: { devUser: 'dev@x.co' }, devQueryParam: 'as' }));
  app.get('/api/me', (req, res) => res.json(req.identity));
  app.get('/api/boom', wrap(async () => { throw new Error('kaboom'); }));
  app.use(errorHandler('test'));
  return app;
}

test('healthz, auth, bearer and error handling', async () => {
  await withServer(makeApp(), async (base) => {
    assert.deepStrictEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
    assert.strictEqual((await (await fetch(`${base}/api/me`)).json()).email, 'dev@x.co');
    assert.strictEqual((await (await fetch(`${base}/api/me?as=bob@x.co`)).json()).email, 'bob@x.co');
    const viaProxy = await fetch(`${base}/api/me`, { headers: { 'x-auth-request-email': 'Real@X.co' } });
    assert.strictEqual((await viaProxy.json()).email, 'real@x.co');
    assert.strictEqual((await fetch(`${base}/svc`)).status, 401);
    assert.strictEqual((await fetch(`${base}/svc`, { headers: { authorization: 'Bearer nope' } })).status, 401);
    assert.strictEqual((await fetch(`${base}/svc`, { headers: { authorization: 'Bearer tok' } })).status, 200);
    const boom = await fetch(`${base}/api/boom`);
    assert.strictEqual(boom.status, 500);
    assert.strictEqual((await boom.json()).error, 'kaboom');
  });
});

test('requireUser answers 401 when nobody is signed in', async () => {
  const app = express();
  app.use(requireUser({ identify: {} }));
  app.get('/', (req, res) => res.send('no'));
  await withServer(app, async (base) => assert.strictEqual((await fetch(base)).status, 401));
});

test('serveSpa injects the suite header for the signed-in user', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html><body class="x"><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(dist, 'app.js'), 'ok');
  const app = express();
  serveSpa(app, express, dist, { appId: 'calendar', identify: { devUser: 'dev@x.co' } });
  await withServer(app, async (base) => {
    for (const p of ['/', '/some/route']) {
      const html = await (await fetch(base + p)).text();
      assert.match(html, /<body class="x"><style>/);
      assert.match(html, /<synergy-app-bar app="calendar" user="dev@x.co"/);
    }
    assert.strictEqual(await (await fetch(`${base}/app.js`)).text(), 'ok');
    const bar = await fetch(`${base}/_suite/app-bar.js`);
    assert.strictEqual(bar.status, 200);
    assert.match(await bar.text(), /synergy-app-bar/);
  });
  assert.doesNotMatch(appBarHtml('a"b', '<x>', ''), /"b|<x>/);
});
