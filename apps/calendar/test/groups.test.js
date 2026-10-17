// Group calendars against the real server and a real Postgres: the Groups app pushes a calendar's
// exact member list, members see its events, others don't. Runs when TEST_DATABASE_URL is set
// (CI sets it); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-svc-token';
const PORT = 5300 + (process.pid % 500);
const alice = 'alice@example.com';   // group owner
const bob = 'bob@example.com';       // member
const carol = 'carol@example.com';   // not a member
const SOURCE = 'groups:11111111-2222-3333-4444-555555555555';
const OTHER = 'groups:99999999-2222-3333-4444-555555555555';

test('calendar group calendars', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_groups_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const db = createDb({ connectionString: dbUrl });
  let child;
  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), DEV_USER_EMAIL: alice, CAL_SVC_TOKEN: TOKEN, NODE_ENV: 'test' },
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
    await db.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });

  // A database from before group calendars: the calendar CHECK must be widened on boot.
  await db.q(`CREATE TABLE events (
    id BIGSERIAL PRIMARY KEY, owner_email TEXT NOT NULL,
    calendar TEXT NOT NULL DEFAULT 'personal' CHECK (calendar IN ('personal','company')),
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL, all_day BOOLEAN NOT NULL DEFAULT false,
    attendees JSONB NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'cal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (start_at < end_at))`);
  await db.q(`INSERT INTO events (owner_email, title, start_at, end_at) VALUES ($1, 'Old', '2027-01-01T10:00Z', '2027-01-01T11:00Z')`, [alice]);
  await boot();
  // ...and booting again is a no-op.
  await stop();
  await boot();

  const svc = async (method, p, body, token = TOKEN) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/svc${p}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const as = async (who, method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api${p}`, {
      method, headers: { 'content-type': 'application/json', 'x-dev-user': who }, body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const titles = async who =>
    (await as(who, 'GET', '/events?from=2027-01-01&to=2027-12-31')).body.map(e => e.title).sort();
  const members = async () =>
    (await db.q('SELECT email, role FROM group_calendar_members WHERE source = $1 ORDER BY email', [SOURCE])).rows;
  const event = (title, extra) => ({ title, startAt: '2027-04-01T10:00:00Z', endAt: '2027-04-01T11:00:00Z', ...extra });

  await t.test('needs the token and a well-formed source', async () => {
    assert.equal((await svc('PUT', `/group-calendars/${SOURCE}`, { name: 'Team', members: [] }, 'wrong')).status, 401);
    assert.equal((await svc('PUT', '/group-calendars/team-a', { name: 'Team', members: [] })).status, 400);
    assert.equal((await svc('PUT', `/group-calendars/${SOURCE}`, { members: [] })).status, 400);
  });

  await t.test('upsert makes the member list exactly what was sent', async () => {
    const r = await svc('PUT', `/group-calendars/${SOURCE}`, {
      name: 'Team A', members: [{ email: alice, role: 'owner' }, { email: bob, role: 'member' }, { email: carol, role: 'member' }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, SOURCE);
    assert.match(r.body.url, /\/$/);
    const again = await svc('PUT', `/group-calendars/${SOURCE}`, {
      name: 'Team Alpha', members: [{ email: ' Alice@Example.com ', role: 'owner' }, { email: bob, role: 'member' }],
    });
    assert.equal(again.status, 200);
    assert.deepEqual(await members(), [{ email: alice, role: 'owner' }, { email: bob, role: 'member' }]);
    const cals = (await as(bob, 'GET', '/calendars')).body;
    assert.deepEqual(cals, [
      { id: 'personal', name: 'Personal' },
      { id: 'company', name: 'Company' },
      { id: `group:${SOURCE}`, source: SOURCE, name: 'Team Alpha', role: 'member' },
    ]);
    assert.equal((await as(carol, 'GET', '/calendars')).body.length, 2);
  });

  await t.test('only members may add events, and only members see them', async () => {
    const created = await as(bob, 'POST', '/events', event('Standup', { calendar: 'group', groupSource: SOURCE }));
    assert.equal(created.status, 200);
    assert.equal(created.body.calendar, 'group');
    assert.equal(created.body.group_source, SOURCE);
    assert.equal((await as(carol, 'POST', '/events', event('Sneaky', { calendar: 'group', groupSource: SOURCE }))).status, 403);
    assert.equal((await as(bob, 'POST', '/events', event('Elsewhere', { calendar: 'group', groupSource: OTHER }))).status, 403);
    assert.equal((await as(bob, 'POST', '/events', event('No source', { calendar: 'group' }))).status, 400);
    assert.deepEqual(await titles(alice), ['Old', 'Standup']);
    assert.deepEqual(await titles(bob), ['Standup']);
    assert.deepEqual(await titles(carol), []);
    // Suite search uses the same rule.
    const hits = async who => (await as(who, 'POST', '/search', { query: 'standup' })).body.results.length;
    assert.equal(await hits(alice), 1);
    assert.equal(await hits(carol), 0);
  });

  await t.test('a group calendar owner may edit and delete events on it; members may not', async () => {
    const { body: ev } = await as(bob, 'POST', '/events', event('Retro', { calendar: 'group', groupSource: SOURCE }));
    assert.equal((await as(carol, 'PATCH', `/events/${ev.id}`, { title: 'Hijacked' })).status, 404);
    const edited = await as(alice, 'PATCH', `/events/${ev.id}`, { title: 'Retro (moved)', calendar: 'group', groupSource: SOURCE });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.owner_email, bob);
    assert.equal((await as(alice, 'PATCH', `/events/${ev.id}`, { calendar: 'personal' })).status, 403);
    const { body: mine } = await as(alice, 'POST', '/events', event('Planning', { calendar: 'group', groupSource: SOURCE }));
    assert.equal((await as(bob, 'DELETE', `/events/${mine.id}`)).status, 404);
    assert.equal((await as(alice, 'DELETE', `/events/${ev.id}`)).status, 200);
    assert.equal((await as(alice, 'DELETE', `/events/${mine.id}`)).status, 200);
    assert.deepEqual(await titles(bob), ['Standup']);
    // The organizer can take their own event off the group calendar.
    const { body: own } = await as(bob, 'POST', '/events', event('Moving', { calendar: 'group', groupSource: SOURCE }));
    const moved = await as(bob, 'PATCH', `/events/${own.id}`, { calendar: 'personal' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.group_source, null);
    assert.deepEqual(await titles(alice), ['Old', 'Standup']);
    assert.equal((await as(bob, 'DELETE', `/events/${own.id}`)).status, 200);
  });

  await t.test('services list and add group events', async () => {
    assert.equal((await svc('POST', '/events', { ownerEmail: carol, ...event('Svc sneaky', { calendar: 'group', groupSource: SOURCE }) })).status, 403);
    const added = await svc('POST', '/events', { ownerEmail: alice, ...event('All hands', { calendar: 'group', groupSource: SOURCE }) });
    assert.equal(added.status, 200);
    const list = await svc('GET', `/group-calendars/${SOURCE}/events?from=2027-01-01&to=2027-12-31`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.events.map(e => e.title).sort(), ['All hands', 'Standup']);
    assert.equal(list.body.events[0].group_source, SOURCE);
    assert.equal((await svc('GET', `/group-calendars/${OTHER}/events`)).status, 404);
    assert.equal((await svc('GET', `/group-calendars/${SOURCE}/events`, undefined, 'wrong')).status, 401);
  });

  await t.test('deleting the group calendar removes visibility, keeps events', async () => {
    assert.equal((await svc('DELETE', `/group-calendars/${SOURCE}`)).status, 200);
    assert.equal((await svc('DELETE', `/group-calendars/${SOURCE}`)).status, 200);
    // Each organizer still sees their own event; nobody sees the other's any more.
    assert.deepEqual(await titles(bob), ['Standup']);
    assert.deepEqual(await titles(alice), ['All hands', 'Old']);
    assert.equal((await as(bob, 'GET', '/calendars')).body.length, 2);
    assert.deepEqual(await members(), []);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM events WHERE group_source = $1', [SOURCE])).rows[0].n, 2);
    assert.equal((await svc('GET', `/group-calendars/${SOURCE}/events`)).status, 404);
  });
});
