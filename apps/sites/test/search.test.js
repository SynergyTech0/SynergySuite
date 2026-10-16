// POST /api/search against the real server and a real Postgres. Runs when TEST_DATABASE_URL is
// set; skipped otherwise. Each run uses its own throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');
const { blocksText } = require('../server/search');

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'test-proxy-secret';
const PORT = 4800 + (process.pid % 500);
const alice = 'alice@example.com';
const bob = 'bob@example.com';

test('page text comes from what the blocks show', () => {
  const t = blocksText([
    { type: 'hero', data: { heading: 'Hello', buttonUrl: 'https://x.example', bg: '#123456' } },
    { type: 'columns', data: { columns: [{ heading: 'One', text: 'First' }] } },
  ]);
  assert.match(t, /Hello/);
  assert.match(t, /First/);
  assert.doesNotMatch(t, /x\.example|#123456/);
});

test('sites search', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `sites_search_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();

  const env = { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), PROXY_SHARED_SECRET: SECRET, NODE_ENV: 'test' };
  delete env.DEV_USER_EMAIL;
  delete env.DEV_EMAIL;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'inherit' });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch {}
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(up, 'server did not start');

  const api = async (method, p, { as, body, secret = SECRET } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (as) headers['x-auth-request-email'] = as;
    if (secret) headers['x-proxy-auth-secret'] = secret;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const search = (as, body) => api('POST', '/api/search', { as, body });

  const site = (await api('POST', '/api/sites', { as: alice, body: { name: 'Harbour Festival' } })).body;
  const page = (await api('POST', `/api/sites/${site.id}/pages`, { as: alice, body: { title: 'Tickets' } })).body;
  await api('PATCH', `/api/pages/${page.id}`, {
    as: alice,
    body: { blocks: [{ type: 'text', data: { text: 'Early bird lanterns sell out fast' } }, { type: 'embed', data: { url: 'https://zebracorn.example' } }] },
  });

  await t.test('401 without a trusted identity', async () => {
    assert.equal((await api('POST', '/api/search', { body: { query: 'harbour' } , secret: '' })).status, 401);
    assert.equal((await api('POST', '/api/search', { as: alice, secret: 'wrong', body: { query: 'harbour' } })).status, 401);
  });

  await t.test('400 on an empty query', async () => {
    const r = await search(alice, { query: '   ' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  await t.test('finds the owner\'s site and page text, with deep links', async () => {
    const r = await search(alice, { query: 'lanterns' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'sites');
    assert.deepEqual(r.body.results.map(x => x.id), [`page:${page.id}`]);
    assert.equal(r.body.results[0].url, `/?site=${site.id}&page=${page.id}`);
    assert.match(r.body.results[0].snippet, /lanterns/);
    const s = await search(alice, { query: 'harbour', kinds: ['site'] });
    assert.deepEqual(s.body.results.map(x => x.id), [`site:${site.id}`]);
    assert.ok(!('text' in s.body.results[0]));
    const withText = await search(alice, { query: 'lanterns', text: true });
    assert.match(withText.body.results[0].text, /Early bird/);
  });

  await t.test('every signed-in person sees every site, as the app shows them', async () => {
    const r = await search(bob, { query: 'harbour festival' });
    assert.ok(r.body.results.some(x => x.id === `site:${site.id}`));
  });

  await t.test('does not match text a page does not show, and honours -words and limit', async () => {
    assert.equal((await search(alice, { query: 'zebracorn' })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'lanterns -bird' })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'harbour OR tickets', limit: 1 })).body.results.length, 1);
  });
});
