// Suite search (POST /api/search) against the real server and a real Postgres, called the way
// the Search app calls it: the person's gateway headers plus the proxy secret. Runs when
// TEST_DATABASE_URL is set (CI sets it); skipped otherwise. Uses its own throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'test-proxy-secret';
const PORT = 4800 + (process.pid % 500);
const alice = 'alice@example.com';
const bob = 'bob@example.com';
const carol = 'carol@example.com';

test('notes suite search', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `notes_search_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();

  const policyServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ holds: [], retention: [], updatedAt: '' }));
  });
  await new Promise(r => policyServer.listen(0, '127.0.0.1', r));

  const env = { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), PROXY_SHARED_SECRET: SECRET,
    ADMIN_INTERNAL_URL: `http://127.0.0.1:${policyServer.address().port}`, NODE_ENV: 'test' };
  delete env.DEV_USER_EMAIL;
  delete env.DEV_EMAIL;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'inherit' });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    policyServer.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch {}
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(up, 'server did not start');

  const api = async (method, p, { as, secret = SECRET, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (as) headers['x-auth-request-email'] = as;
    if (secret) headers['x-proxy-auth-secret'] = secret;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const search = (as, body) => api('POST', '/api/search', { as, body });

  const page = async (as, b) => (await api('POST', '/api/pages', { as, body: b })).body;
  const overview = await page(alice, { title: 'Kiwi overview', body: '# Kiwi\n\nThe **launch** is in May.' });
  const salaries = await page(alice, { title: 'Kiwi salaries', body: 'Only for me' });
  await api('POST', `/api/pages/${salaries.id}/restrictions`, { as: alice, body: { email: alice } });
  const space = (await api('POST', '/api/spaces', { as: bob, body: { name: 'Bob private' } })).body;
  await api('PATCH', `/api/spaces/${space.id}`, { as: bob, body: { restricted: true } });
  const bobs = await page(bob, { title: 'Bob notes', body: 'kiwi secrets', spaceId: space.id });
  const trashed = await page(alice, { title: 'Kiwi draft', body: 'old' });
  assert.equal((await api('DELETE', `/api/pages/${trashed.id}`, { as: alice })).status, 200);

  const ids = r => r.body.results.map(x => x.id).sort();
  const pg = x => `page:${x.id}`;

  await t.test('finds my own pages, newest first, with a deep link', async () => {
    const r = await search(alice, { query: 'kiwi' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'notes');
    assert.deepEqual(r.body.results.map(x => x.id), [pg(salaries), pg(overview)]);
    const h = r.body.results[1];
    assert.equal(h.kind, 'page');
    assert.equal(h.title, 'Kiwi overview');
    assert.equal(h.person, alice);
    assert.equal(h.url, `/?space=${overview.space_id}&page=${overview.id}`);
    assert.match(h.snippet, /Kiwi The launch is in May/);
  });

  await t.test("never returns pages in a restricted space, pages restricted to others, or trashed pages", async () => {
    assert.deepEqual(ids(await search(bob, { query: 'kiwi' })), [pg(overview), pg(bobs)].sort());
    assert.deepEqual(ids(await search(carol, { query: 'kiwi' })), [pg(overview)]);
    assert.equal((await search(alice, { query: 'secrets' })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'draft' })).body.results.length, 0);
  });

  await t.test('returns pages in a space shared with the person', async () => {
    await api('POST', `/api/spaces/${space.id}/members`, { as: bob, body: { email: carol, role: 'viewer' } });
    assert.deepEqual(ids(await search(carol, { query: 'kiwi' })), [pg(overview), pg(bobs)].sort());
    await api('POST', `/api/pages/${salaries.id}/restrictions`, { as: alice, body: { email: carol } });
    assert.ok(ids(await search(carol, { query: 'salaries' })).includes(pg(salaries)));
  });

  await t.test('kinds, limit and text', async () => {
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['event'] })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['page'], limit: 1 })).body.results.length, 1);
    const r = await search(alice, { query: 'launch', text: true });
    assert.equal(r.body.results[0].text, 'Kiwi overview Kiwi The launch is in May.');
  });

  await t.test('needs the gateway identity', async () => {
    assert.equal((await api('POST', '/api/search', { body: { query: 'kiwi' } })).status, 401);
    assert.equal((await api('POST', '/api/search', { as: alice, secret: 'wrong', body: { query: 'kiwi' } })).status, 401);
  });

  await t.test('400 on an empty query', async () => {
    const r = await search(alice, { query: '-kiwi' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });
});
