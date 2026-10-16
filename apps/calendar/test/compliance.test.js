// Compliance protocol against the real server and a real Postgres. Runs when TEST_DATABASE_URL is
// set (CI sets it); skipped otherwise. Each run uses its own throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-compliance-token';
const PORT = 4300 + (process.pid % 500);
const alice = 'alice@example.com';   // on hold
const bob = 'bob@example.com';
const carol = 'carol@example.com';

const policy = {
  holds: [{ id: 'h1', name: 'Matter', custodians: [alice], apps: ['calendar'] }],
  retention: [{ id: 'r1', app: 'calendar', days: 30 }],
  updatedAt: '',
};

test('calendar compliance', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_compliance_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const db = createDb({ connectionString: dbUrl });

  const policyServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(policy));
  });
  await new Promise(r => policyServer.listen(0, '127.0.0.1', r));

  let child;
  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: {
        ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), DEV_USER_EMAIL: 'ci@example.com',
        COMPLIANCE_TOKEN: TOKEN, ADMIN_INTERNAL_URL: `http://127.0.0.1:${policyServer.address().port}`,
        NODE_ENV: 'test',
      },
      stdio: 'inherit',
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('server did not start');
  };
  const stop = () => new Promise(r => { child.once('exit', r); child.kill(); });
  t.after(async () => {
    if (child && child.exitCode == null) await stop();
    policyServer.close();
    await db.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });

  const api = async (method, p, { as, token, body } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (as) headers['x-dev-user'] = as;
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const search = body => api('POST', '/api/compliance/search', { token: TOKEN, body });
  const event = async (as, title, startAt, extra = {}) => (await api('POST', '/api/events', {
    as, body: { title, startAt, endAt: new Date(new Date(startAt).getTime() + 3600000).toISOString(), ...extra },
  })).body;

  await boot();
  const e1 = await event(alice, 'Merger kickoff', '2027-03-10T15:00:00Z', { attendees: [bob], description: 'Agenda: the merger timeline', location: 'Room 4' });
  const e2 = await event(alice, 'Lunch', '2027-03-11T12:00:00Z');
  const e3 = await event(bob, 'Merger follow-up', '2027-04-01T09:00:00Z', { attendees: [carol] });

  await t.test('needs the token, not a signed-in user', async () => {
    assert.equal((await api('POST', '/api/compliance/search', { body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/search', { as: alice, body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/export', { token: 'wrong', body: { ids: [] } })).status, 401);
  });

  await t.test('rejects bad input', async () => {
    assert.equal((await search({ limit: 0 })).status, 400);
    assert.equal((await search({ to: 'soon' })).status, 400);
    assert.equal((await search({ kinds: 'event' })).status, 400);
    assert.equal((await api('POST', '/api/compliance/export', { token: TOKEN, body: {} })).status, 400);
  });

  await t.test('search: keywords, custodians, dates, kinds and paging', async () => {
    const r = await search({ query: 'merger' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'calendar');
    assert.deepEqual(r.body.hits.map(h => h.id), [`event:${e3.id}`, `event:${e1.id}`]);
    const h = r.body.hits[1];
    assert.equal(h.owner, alice);
    assert.deepEqual(h.participants, [bob]);
    assert.equal(h.date, '2027-03-10T15:00:00.000Z');
    assert.equal((await search({ query: 'timeline' })).body.hits[0].snippet.includes('merger timeline'), true);
    assert.equal((await search({ query: 'merger', custodians: [carol] })).body.total, 1);
    assert.equal((await search({ query: 'merger', custodians: [bob] })).body.total, 2);
    assert.equal((await search({ query: 'merger', from: '2027-03-11', to: '2027-04-01' })).body.total, 1);
    assert.equal((await search({ query: 'merger', to: '2027-03-10' })).body.total, 1);
    assert.equal((await search({ kinds: ['message'] })).body.hits.length, 0);
    const p1 = await search({ limit: 2 });
    assert.equal(p1.body.total, 3);
    const p2 = await search({ limit: 2, cursor: p1.body.nextCursor });
    assert.deepEqual(p2.body.hits.map(h => h.id), [`event:${e1.id}`]);
  });

  await t.test('a held organizer keeps what their edits replace; others do not', async () => {
    const m = await event(alice, 'Board prep', '2027-05-01T10:00:00Z', { location: 'Vault room' });
    const n = await event(bob, 'Bob standup', '2027-05-02T10:00:00Z', { location: 'Cafe' });
    assert.equal((await api('PATCH', `/api/events/${m.id}`, { as: alice, body: { location: 'Online' } })).status, 200);
    assert.equal((await api('PATCH', `/api/events/${n.id}`, { as: bob, body: { location: 'Online' } })).status, 200);
    const mine = (await api('GET', '/api/events?from=2027-01-01&to=2027-12-31', { as: alice })).body;
    assert.ok(!JSON.stringify(mine).includes('Vault'));
    const r = (await search({ query: 'vault' })).body;
    assert.deepEqual(r.hits.map(h => h.id), [`event:${m.id}`]);
    assert.match(r.hits[0].snippet, /Vault room/);
    assert.equal((await search({ query: 'cafe' })).body.total, 0);
    const ex = (await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`event:${m.id}`, `event:${n.id}`] } })).body.items;
    const it = ex.find(i => i.id === `event:${m.id}`);
    assert.equal(it.metadata.location, 'Online');
    assert.equal(it.metadata.previousVersions.length, 1);
    assert.equal(it.metadata.previousVersions[0].location, 'Vault room');
    assert.ok(it.metadata.previousVersions[0].replacedAt);
    assert.deepEqual(ex.find(i => i.id === `event:${n.id}`).metadata.previousVersions, []);
    // Leave the earlier counts as they were.
    await db.q('DELETE FROM events WHERE id = ANY($1::bigint[])', [[m.id, n.id]]);
  });

  await t.test('a held organizer keeps what they delete; others do not', async () => {
    assert.equal((await api('DELETE', `/api/events/${e2.id}`, { as: alice })).status, 200);
    assert.equal((await api('DELETE', `/api/events/${e2.id}`, { as: alice })).status, 404);
    assert.equal((await api('DELETE', `/api/events/${e3.id}`, { as: bob })).status, 200);
    const mine = (await api('GET', '/api/events?from=2027-01-01&to=2027-12-31', { as: alice })).body;
    assert.deepEqual(mine.map(e => e.id), [e1.id]);
    assert.equal((await api('PATCH', `/api/events/${e2.id}`, { as: alice, body: { title: 'x' } })).status, 404);
    const hits = (await search({})).body.hits;
    assert.equal(hits.find(h => h.id === `event:${e2.id}`).deleted, true);
    assert.ok(!hits.some(h => h.id === `event:${e3.id}`));
    assert.equal((await db.q('SELECT count(*)::int AS n FROM events WHERE id = $1', [e3.id])).rows[0].n, 0);
  });

  await t.test('export returns the description and event details', async () => {
    const r = await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`event:${e1.id}`, `event:${e2.id}`, 'event:999'] } });
    assert.equal(r.body.items.length, 2);
    const it = r.body.items[0];
    assert.equal(it.app, 'calendar');
    assert.equal(it.text, 'Agenda: the merger timeline');
    assert.equal(it.metadata.location, 'Room 4');
    assert.deepEqual(it.metadata.attendees, [bob]);
    assert.equal(r.body.items[1].deleted, true);
  });

  await t.test('retention deletes old events unless the organizer is on hold', async () => {
    const old = new Date(Date.now() - 60 * 86400000);
    const ins = who => db.q(
      `INSERT INTO events (owner_email, title, start_at, end_at) VALUES ($1, 'Old', $2, $3) RETURNING id`,
      [who, old, new Date(old.getTime() + 3600000)]).then(r => r.rows[0].id);
    const keep = await ins(alice), drop = await ins(bob);
    await stop();
    await boot(); // the sweep runs at start
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = (await db.q('SELECT 1 FROM events WHERE id = $1', [drop])).rows.length === 0;
      if (!gone) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(gone);
    const kept = (await db.q('SELECT held_deleted_at FROM events WHERE id = $1', [keep])).rows[0];
    assert.ok(kept);
    assert.equal(kept.held_deleted_at, null);
  });
});
