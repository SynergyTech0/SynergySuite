// The service API Bookings uses, against the real server and a real Postgres. Runs when
// TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-svc-token';
const PORT = 4800 + (process.pid % 500);
const alice = 'alice@example.com';

test('calendar service API', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_svc_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), DEV_USER_EMAIL: alice, CAL_SVC_TOKEN: TOKEN, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  t.after(async () => {
    await new Promise(r => { child.once('exit', r); child.kill(); });
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });

  const svc = async (method, p, body, token = TOKEN) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/svc${p}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const busy = async () => (await svc('GET', `/freebusy?email=${alice}&from=2027-01-01&to=2027-12-31`)).body.busy;

  const { body: { id } } = await svc('POST', '/events', {
    ownerEmail: alice, title: 'Check-up: Carol', startAt: '2027-03-10T15:00:00Z', endAt: '2027-03-10T15:30:00Z',
    attendees: ['carol@example.org'], source: 'booking',
  });
  const { body: { id: own } } = await (await fetch(`http://127.0.0.1:${PORT}/api/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Mine', startAt: '2027-03-11T15:00:00Z', endAt: '2027-03-11T16:00:00Z' }),
  })).json().then(b => ({ body: b }));

  await t.test('lists what a person\'s calendar shows, without descriptions or attendees', async () => {
    const r = await svc('GET', `/events?email=${alice}&from=2027-03-10T00:00:00Z&to=2027-03-12T00:00:00Z`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.events.map(e => e.title), ['Check-up: Carol', 'Mine']);
    assert.equal(r.body.events[0].source, 'booking');
    assert.equal(r.body.events[0].mine, true);
    for (const e of r.body.events) {
      assert.equal(e.description, undefined);
      assert.equal(e.attendees, undefined);
    }
    assert.equal((await svc('GET', `/events?email=${alice}`, undefined, 'wrong')).status, 401);
    assert.equal((await svc('GET', '/events?email=nobody')).status, 400);
    assert.equal((await svc('GET', `/events?email=${alice}&from=2027-01-01&to=2027-06-01`)).status, 400, 'at most 62 days');
  });

  await t.test('needs the token', async () => {
    assert.equal((await svc('GET', `/freebusy?email=${alice}`, undefined, 'wrong')).status, 401);
    assert.equal((await svc('DELETE', `/events/${id}?ownerEmail=${alice}&source=booking`, undefined, 'wrong')).status, 401);
  });

  await t.test('moves only events it added, on the named calendar', async () => {
    assert.equal((await svc('PATCH', `/events/${id}`, { ownerEmail: alice, source: 'booking', startAt: '2027-03-10T16:00:00Z', endAt: '2027-03-10T16:30:00Z' })).status, 200);
    assert.deepEqual((await busy()).map(b => b.start), ['2027-03-10T16:00:00.000Z', '2027-03-11T15:00:00.000Z']);
    assert.equal((await svc('PATCH', `/events/${id}`, { ownerEmail: alice, source: 'booking', startAt: '2027-03-10T17:00:00Z' })).status, 400);
    assert.equal((await svc('PATCH', `/events/${id}`, { ownerEmail: 'bob@example.com', source: 'booking', startAt: '2027-03-10T15:00:00Z' })).status, 404);
    assert.equal((await svc('PATCH', `/events/${own}`, { ownerEmail: alice, source: 'booking', startAt: '2027-03-11T14:00:00Z' })).status, 404);
  });

  await t.test('removes only events it added', async () => {
    assert.equal((await svc('DELETE', `/events/${own}?ownerEmail=${alice}&source=booking`)).status, 404);
    assert.equal((await svc('DELETE', `/events/${id}?ownerEmail=${alice}&source=booking`)).status, 200);
    assert.equal((await svc('DELETE', `/events/${id}?ownerEmail=${alice}&source=booking`)).status, 404);
    assert.deepEqual((await busy()).map(b => b.start), ['2027-03-11T15:00:00.000Z']);
  });
});
