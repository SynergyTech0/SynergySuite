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

test('calendar suite search', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_search_${process.pid}`;
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

  const ev = async (as, b) => (await api('POST', '/api/events', { as, body: { startAt: b.start, endAt: new Date(new Date(b.start).getTime() + 3600000).toISOString(), ...b } })).body;
  const review = await ev(alice, { title: 'Kiwi review', description: 'Go through the numbers', location: 'Room 4', start: '2026-03-02T10:00:00Z', attendees: [carol] });
  const allHands = await ev(alice, { title: 'All-hands', description: 'Kiwi roadmap for the company', calendar: 'company', start: '2026-03-05T16:00:00Z' });
  const dentist = await ev(bob, { title: 'Dentist (kiwi street)', start: '2026-03-03T09:00:00Z' });
  const gone = await ev(alice, { title: 'Kiwi cancelled', start: '2026-03-04T09:00:00Z' });
  assert.equal((await api('DELETE', `/api/events/${gone.id}`, { as: alice })).status, 200);

  const ids = r => r.body.results.map(x => x.id).sort();
  const e = x => `event:${x.id}`;

  await t.test('finds my own events, newest first, with a deep link', async () => {
    const r = await search(alice, { query: 'kiwi' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'calendar');
    assert.deepEqual(r.body.results.map(x => x.id), [e(allHands), e(review)]);
    const h = r.body.results[1];
    assert.equal(h.kind, 'event');
    assert.equal(h.title, 'Kiwi review');
    assert.equal(h.date, '2026-03-02T10:00:00.000Z');
    assert.equal(h.person, alice);
    assert.equal(h.url, `/?event=${review.id}&at=${encodeURIComponent('2026-03-02T10:00:00.000Z')}`);
    assert.match(h.snippet, /Room 4/);
    assert.equal((await search(alice, { query: 'room' })).body.results.length, 1);
  });

  await t.test("never returns another person's private events or deleted ones", async () => {
    assert.deepEqual(ids(await search(bob, { query: 'kiwi' })), [e(allHands), e(dentist)].sort());
    assert.equal((await search(alice, { query: 'dentist' })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'cancelled' })).body.results.length, 0);
  });

  await t.test('returns shared events: the company calendar and invitations', async () => {
    assert.deepEqual(ids(await search(carol, { query: 'kiwi' })), [e(allHands), e(review)].sort());
  });

  await t.test('kinds, limit and text', async () => {
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['message'] })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['event'], limit: 1 })).body.results.length, 1);
    const r = await search(alice, { query: 'kiwi -roadmap', text: true });
    assert.deepEqual(r.body.results.map(x => x.id), [e(review)]);
    assert.match(r.body.results[0].text, /Go through the numbers/);
  });

  await t.test('needs the gateway identity', async () => {
    assert.equal((await api('POST', '/api/search', { body: { query: 'kiwi' } })).status, 401);
    assert.equal((await api('POST', '/api/search', { as: alice, secret: 'wrong', body: { query: 'kiwi' } })).status, 401);
  });

  await t.test('400 on an empty query', async () => {
    const r = await search(alice, { query: '' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });
});
