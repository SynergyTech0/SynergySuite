// Repeating events through the API, against the real server and a real Postgres: editing and
// deleting one occurrence, this and following, or all; and the readers that must see every
// occurrence (free/busy for Bookings, suite search, eDiscovery). Runs when TEST_DATABASE_URL is
// set (CI sets it); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const PORT = 5300 + (process.pid % 500);
const SVC = 'svc-token';
const COMPLIANCE = 'compliance-token';
const SECRET = 'proxy-secret';
const alice = 'alice@example.com';
const bob = 'bob@example.com';

test('repeating events', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_series_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const policyServer = http.createServer((req, res) => res.end(JSON.stringify({ holds: [], retention: [{ id: 'r', app: 'calendar', days: 30 }], updatedAt: '' })));
  await new Promise(r => policyServer.listen(0, '127.0.0.1', r));
  const env = { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), CAL_SVC_TOKEN: SVC, COMPLIANCE_TOKEN: COMPLIANCE,
    PROXY_SHARED_SECRET: SECRET, ADMIN_INTERNAL_URL: `http://127.0.0.1:${policyServer.address().port}`, NODE_ENV: 'test' };
  delete env.DEV_USER_EMAIL;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'inherit' });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    policyServer.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }

  const api = async (method, p, body, as = alice) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method, body: body && JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-auth-request-email': as, 'x-proxy-auth-secret': SECRET },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const list = async (from, to, as = alice) => (await api('GET', `/api/events?from=${from}&to=${to}`, null, as)).body;
  const starts = evs => evs.map(e => `${new Date(e.start_at).toISOString().slice(5, 16)} ${e.title}`);

  // Mondays and Wednesdays at 9:30 New York time, with Bob invited.
  const { body: s } = await api('POST', '/api/events', {
    title: 'Standup', startAt: '2026-03-02T14:30:00Z', endAt: '2026-03-02T15:00:00Z', tzid: 'America/New_York',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', attendees: [bob],
  });
  assert.strictEqual(s.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE');

  await t.test('every occurrence in the range, at 9:30 local on both sides of the DST change', async () => {
    const evs = await list('2026-03-01', '2026-03-12');
    assert.deepStrictEqual(starts(evs), ['03-02T14:30 Standup', '03-04T14:30 Standup', '03-09T13:30 Standup', '03-11T13:30 Standup']);
    assert.ok(evs.every(e => String(e.id) === String(s.id) && e.recurring && e.occurrence));
    // Invited people see them too, and so does their free/busy.
    assert.strictEqual((await list('2026-03-01', '2026-03-12', bob)).length, 4);
    const r = await fetch(`http://127.0.0.1:${PORT}/api/svc/freebusy?email=${bob}&from=2026-03-01&to=2026-03-12`, { headers: { authorization: `Bearer ${SVC}` } });
    assert.deepStrictEqual((await r.json()).busy.map(b => b.start), ['2026-03-02T14:30:00.000Z', '2026-03-04T14:30:00.000Z', '2026-03-09T13:30:00.000Z', '2026-03-11T13:30:00.000Z']);
  });

  await t.test('this event: one occurrence moved and renamed, the rest unchanged', async () => {
    const r = await api('PATCH', `/api/events/${s.id}`, { scope: 'this', occurrence: '2026-03-04T14:30:00.000Z', title: 'Standup (late)', startAt: '2026-03-04T17:00:00Z', endAt: '2026-03-04T17:30:00Z' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(starts(await list('2026-03-01', '2026-03-10')), ['03-02T14:30 Standup', '03-04T17:00 Standup (late)', '03-09T13:30 Standup']);
    // Editing the moved one again changes that override, not a new one.
    const again = await api('PATCH', `/api/events/${r.body.id}`, { scope: 'this', location: 'Room 2' });
    assert.strictEqual(again.body.id, r.body.id);
    assert.strictEqual(again.body.location, 'Room 2');
    assert.strictEqual((await api('PATCH', `/api/events/${s.id}`, { scope: 'this', occurrence: '2026-03-05T14:30:00.000Z', title: 'x' })).status, 400);
  });

  await t.test('all events: a new title follows into occurrences that kept the old one', async () => {
    await api('PATCH', `/api/events/${s.id}`, { scope: 'all', occurrence: '2026-03-09T13:30:00.000Z', title: 'Daily sync' });
    assert.deepStrictEqual(starts(await list('2026-03-01', '2026-03-10')), ['03-02T14:30 Daily sync', '03-04T17:00 Standup (late)', '03-09T13:30 Daily sync']);
  });

  await t.test('delete this event: an exception, gone from free/busy', async () => {
    assert.strictEqual((await api('DELETE', `/api/events/${s.id}?scope=this&occurrence=2026-03-09T13:30:00.000Z`)).status, 200);
    assert.deepStrictEqual(starts(await list('2026-03-08', '2026-03-12')), ['03-11T13:30 Daily sync']);
    const busy = (await api('GET', `/api/freebusy?email=${alice}&from=2026-03-08&to=2026-03-12`)).body.busy;
    assert.deepStrictEqual(busy.map(b => b.start), ['2026-03-11T13:30:00.000Z']);
  });

  let newSeries;
  await t.test('this and following: the series splits, earlier ones untouched', async () => {
    const r = await api('PATCH', `/api/events/${s.id}`, { scope: 'following', occurrence: '2026-03-16T13:30:00.000Z', title: 'Planning', startAt: '2026-03-16T14:00:00Z', endAt: '2026-03-16T15:00:00Z' });
    assert.strictEqual(r.status, 200);
    newSeries = r.body;
    assert.notStrictEqual(String(newSeries.id), String(s.id));
    assert.deepStrictEqual(starts(await list('2026-03-10', '2026-03-24')), ['03-11T13:30 Daily sync', '03-16T14:00 Planning', '03-18T14:00 Planning', '03-23T14:00 Planning']);
    // The first part still has its exception and its moved occurrence.
    assert.deepStrictEqual(starts(await list('2026-03-01', '2026-03-10')), ['03-02T14:30 Daily sync', '03-04T17:00 Standup (late)']);
  });

  await t.test('delete this and following, then all', async () => {
    assert.strictEqual((await api('DELETE', `/api/events/${newSeries.id}?scope=following&occurrence=2026-03-23T14:00:00.000Z`)).status, 200);
    assert.deepStrictEqual(starts(await list('2026-03-15', '2026-04-15')), ['03-16T14:00 Planning', '03-18T14:00 Planning']);
    assert.strictEqual((await api('DELETE', `/api/events/${newSeries.id}?scope=all`)).status, 200);
    assert.deepStrictEqual(await list('2026-03-15', '2026-04-15'), []);
  });

  await t.test('a monthly series found by search on its next date, and by eDiscovery by any occurrence', async () => {
    const { body: m } = await api('POST', '/api/events', {
      title: 'Board review', startAt: '2020-01-14T15:00:00Z', endAt: '2020-01-14T16:00:00Z', tzid: 'Europe/London', rrule: 'FREQ=MONTHLY;BYDAY=2TU',
    });
    const r = await api('POST', '/api/search', { query: 'board' });
    const hit = r.body.results.find(x => x.id === `event:${m.id}`);
    assert.ok(new Date(hit.date) >= new Date(Date.now() - 3600000), 'dated at its next occurrence');
    assert.match(hit.url, new RegExp(`event=${m.id}&at=`));
    const search = async body => (await (await fetch(`http://127.0.0.1:${PORT}/api/compliance/search`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${COMPLIANCE}` }, body: JSON.stringify(body),
    })).json());
    const inMarch = await search({ query: 'board', from: '2026-03-01', to: '2026-03-31' });
    assert.deepStrictEqual(inMarch.hits.map(h => [h.id, h.date]), [[`event:${m.id}`, '2026-03-10T15:00:00.000Z']]);
    // 2026-03-11..13 has no second Tuesday: not found.
    assert.strictEqual((await search({ query: 'board', from: '2026-03-11', to: '2026-03-13' })).total, 0);
    const exp = await (await fetch(`http://127.0.0.1:${PORT}/api/compliance/export`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${COMPLIANCE}` }, body: JSON.stringify({ ids: [`event:${m.id}`] }),
    })).json();
    assert.strictEqual(exp.items[0].metadata.repeat, 'FREQ=MONTHLY;BYDAY=2TU');
    assert.strictEqual(exp.items[0].metadata.timeZone, 'Europe/London');
  });

  await t.test('a non-repeating event becomes a series, and back', async () => {
    const { body: e } = await api('POST', '/api/events', { title: 'Lunch', startAt: '2026-05-04T16:00:00Z', endAt: '2026-05-04T17:00:00Z', tzid: 'UTC' });
    await api('PATCH', `/api/events/${e.id}`, { rrule: 'FREQ=DAILY;COUNT=3' });
    assert.strictEqual((await list('2026-05-01', '2026-05-31')).filter(x => x.title === 'Lunch').length, 3);
    await api('PATCH', `/api/events/${e.id}`, { scope: 'all', occurrence: '2026-05-05T16:00:00.000Z', rrule: null });
    assert.strictEqual((await list('2026-05-01', '2026-05-31')).filter(x => x.title === 'Lunch').length, 1);
  });

  await t.test('bad input is refused', async () => {
    assert.strictEqual((await api('POST', '/api/events', { title: 'x', startAt: '2026-05-04T16:00:00Z', endAt: '2026-05-04T17:00:00Z', rrule: 'FREQ=SECONDLY' })).status, 400);
    assert.strictEqual((await api('POST', '/api/events', { title: 'x', startAt: '2026-05-04T16:00:00Z', endAt: '2026-05-04T17:00:00Z', rrule: 'FREQ=DAILY', tzid: 'Mars/Base' })).body.tzid, 'UTC');
    assert.strictEqual((await api('GET', '/api/events?from=2020-01-01&to=2030-01-01')).status, 400);
    assert.strictEqual((await api('PATCH', `/api/events/${s.id}`, { title: 'not mine' }, bob)).status, 404);
  });

});
