// CalDAV against the real server and a real Postgres, with a stand-in for the account service
// that checks app passwords. Runs when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const PORT = 5900 + (process.pid % 500);
const SECRET = 'proxy-secret';
const alice = 'alice@example.com';
const bob = 'bob@example.com';
const PASSWORDS = { [alice]: 'aaaa-bbbb-cccc-dddd', [bob]: 'eeee-ffff-gggg-hhhh' };

test('CalDAV', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `calendar_dav_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  let checks = 0;
  const authServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      checks++;
      const b = JSON.parse(body || '{}');
      const ok = req.headers['x-proxy-auth-secret'] === SECRET && PASSWORDS[b.email] === b.password;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { email: b.email } : { error: 'no' }));
    });
  });
  const policyServer = http.createServer((req, res) => res.end(JSON.stringify({ holds: [], retention: [], updatedAt: '' })));
  await new Promise(r => authServer.listen(0, '127.0.0.1', r));
  await new Promise(r => policyServer.listen(0, '127.0.0.1', r));
  const env = { ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), PROXY_SHARED_SECRET: SECRET, NODE_ENV: 'test',
    AUTH_INTERNAL_URL: `http://127.0.0.1:${authServer.address().port}`, ADMIN_INTERNAL_URL: `http://127.0.0.1:${policyServer.address().port}` };
  delete env.DEV_USER_EMAIL;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'inherit' });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    authServer.close();
    policyServer.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }

  const base = `http://127.0.0.1:${PORT}`;
  const dav = async (method, p, { body, as = alice, headers = {}, password } = {}) => {
    const r = await fetch(base + p, {
      method, body, redirect: 'manual',
      headers: { authorization: 'Basic ' + Buffer.from(`${as}:${password ?? PASSWORDS[as]}`).toString('base64'), 'content-type': 'application/xml', ...headers },
    });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  const web = async (method, p, body, as = alice) => {
    const r = await fetch(base + p, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-auth-request-email': as, 'x-proxy-auth-secret': SECRET } });
    return r.json();
  };
  const home = `/dav/calendars/${alice}/`;
  const personal = `${home}personal/`;
  const syncToken = text => /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(text)?.[1];
  const sync = (coll, token, as = alice) => dav('REPORT', coll, { as, body: `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>` });

  await t.test('discovery and sign-in', async () => {
    const wk = await dav('PROPFIND', '/.well-known/caldav');
    assert.strictEqual(wk.status, 301);
    assert.strictEqual(wk.headers.get('location'), '/dav/');
    assert.strictEqual((await dav('PROPFIND', '/dav/', { password: 'wrong' })).status, 401);
    const root = await dav('PROPFIND', '/', { headers: { depth: '0' }, body: '<propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>' });
    assert.strictEqual(root.status, 207);
    assert.match(root.text, /\/dav\/principals\/alice@example.com\//);
    const pr = await dav('PROPFIND', `/dav/principals/${alice}/`, { headers: { depth: '0' }, body: '<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/></prop></propfind>' });
    assert.match(pr.text, new RegExp(`<d:href>${home}</d:href>`));
    const cals = await dav('PROPFIND', home, { headers: { depth: '1' }, body: '<propfind xmlns="DAV:"><prop><displayname/><resourcetype/><current-user-privilege-set/></prop></propfind>' });
    for (const n of ['Calendar', 'Company', 'Invitations']) assert.match(cals.text, new RegExp(`<d:displayname>${n}</d:displayname>`));
    assert.strictEqual((await dav('PROPFIND', `/dav/calendars/${bob}/personal/`)).status, 403);
    assert.ok(checks <= 3, 'sign-ins are cached');
  });

  const ics = (summary, extra = '') => [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Phone//EN',
    'BEGIN:VEVENT', 'UID:phone-1', 'DTSTAMP:20260301T000000Z', 'DTSTART;TZID=Europe/Paris:20260302T100000', 'DTEND;TZID=Europe/Paris:20260302T110000',
    `SUMMARY:${summary}`, 'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Paris:20260316T100000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'DESCRIPTION:Soon', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:phone-1', 'DTSTAMP:20260301T000000Z', 'RECURRENCE-ID;TZID=Europe/Paris:20260309T100000',
    'DTSTART;TZID=Europe/Paris:20260309T140000', 'DTEND;TZID=Europe/Paris:20260309T150000', `SUMMARY:${summary} (afternoon)`, 'END:VEVENT',
    extra, 'END:VCALENDAR', '',
  ].filter(Boolean).join('\r\n');

  let token;
  await t.test('a series made on the phone shows in the web app, exceptions and all', async () => {
    token = syncToken((await sync(personal, '')).text);
    assert.ok(token);
    const put = await dav('PUT', `${personal}phone-1.ics`, { body: ics('Yoga'), headers: { 'content-type': 'text/calendar', 'if-none-match': '*' } });
    assert.strictEqual(put.status, 201);
    const evs = await web('GET', '/api/events?from=2026-03-01&to=2026-04-01');
    assert.deepStrictEqual(evs.map(e => [e.title, new Date(e.start_at).toISOString()]), [
      ['Yoga', '2026-03-02T09:00:00.000Z'], ['Yoga (afternoon)', '2026-03-09T13:00:00.000Z'], ['Yoga', '2026-03-23T09:00:00.000Z'],
    ]);
    const r = await sync(personal, token);
    assert.match(r.text, /phone-1\.ics/);
    token = syncToken(r.text);
  });

  await t.test('an edit in the web app syncs back, alarms kept', async () => {
    const [first] = await web('GET', '/api/events?from=2026-03-01&to=2026-03-03');
    await web('PATCH', `/api/events/${first.id}`, { scope: 'this', occurrence: first.occurrence, title: 'Yoga (first class)' });
    const r = await sync(personal, token);
    assert.match(r.text, /phone-1\.ics/);
    token = syncToken(r.text);
    const got = await dav('GET', `${personal}phone-1.ics`);
    assert.strictEqual(got.status, 200);
    assert.match(got.text, /RECURRENCE-ID;TZID=Europe\/Paris:20260302T100000/);
    assert.match(got.text, /SUMMARY:Yoga \(first class\)/);
    assert.match(got.text, /TRIGGER:-PT10M/);
    assert.match(got.text, /EXDATE;TZID=Europe\/Paris:20260316T100000/);
    // A stale ETag is refused; the current one works.
    assert.strictEqual((await dav('PUT', `${personal}phone-1.ics`, { body: ics('Pilates'), headers: { 'if-match': '"1"' } })).status, 412);
    assert.strictEqual((await dav('PUT', `${personal}phone-1.ics`, { body: ics('Pilates'), headers: { 'if-match': got.headers.get('etag') } })).status, 204);
    const titles = (await web('GET', '/api/events?from=2026-03-01&to=2026-04-01')).map(e => e.title);
    assert.deepStrictEqual(titles, ['Pilates', 'Pilates (afternoon)', 'Pilates']);
  });

  await t.test('calendar-query by time range and multiget', async () => {
    await web('POST', '/api/events', { title: 'Dentist', startAt: '2026-06-01T09:00:00Z', endAt: '2026-06-01T10:00:00Z' });
    const q = await dav('REPORT', personal, { headers: { depth: '1' }, body: `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop>
      <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="20260520T000000Z" end="20260610T000000Z"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>` });
    assert.match(q.text, /SUMMARY:Dentist/);
    assert.doesNotMatch(q.text, /Pilates/);
    const q2 = await dav('REPORT', personal, { body: `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop>
      <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="20260323T000000Z" end="20260324T000000Z"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>` });
    assert.match(q2.text, /phone-1\.ics/);
    assert.doesNotMatch(q2.text, /Dentist|\.ics<\/d:href>.*\.ics<\/d:href>/s);
    const m = await dav('REPORT', personal, { body: `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>${personal}phone-1.ics</D:href><D:href>${personal}nope.ics</D:href></C:calendar-multiget>` });
    assert.match(m.text, /BEGIN:VCALENDAR/);
    assert.match(m.text, /nope\.ics<\/d:href><d:status>HTTP\/1.1 404/);
  });

  await t.test('moving to the company calendar leaves this one, and invitations are read-only', async () => {
    const before = syncToken((await sync(personal, token)).text);
    const [dentist] = (await web('GET', '/api/events?from=2026-06-01&to=2026-06-02'));
    await web('PATCH', `/api/events/${dentist.id}`, { calendar: 'company', attendees: [bob] });
    const r = await sync(personal, before);
    assert.match(r.text, /\.ics<\/d:href><d:status>HTTP\/1.1 404/);
    const company = await dav('PROPFIND', `/dav/calendars/${bob}/company/`, { as: bob, headers: { depth: '1' } });
    assert.match(company.text, new RegExp(`${dentist.uid}\\.ics`));
    // Bob can read the company event but not change it; he can't write to Invitations at all.
    const href = `/dav/calendars/${bob}/company/${dentist.uid}.ics`;
    const got = await dav('GET', href, { as: bob });
    assert.strictEqual((await dav('PUT', href, { as: bob, body: got.text })).status, 403);
    assert.strictEqual((await dav('DELETE', href, { as: bob })).status, 403);
    assert.strictEqual((await dav('PUT', `/dav/calendars/${bob}/invited/x.ics`, { as: bob, body: ics('x') })).status, 403);
  });

  await t.test('a delete on the phone removes the series; bad data is refused', async () => {
    assert.strictEqual((await dav('DELETE', `${personal}phone-1.ics`)).status, 204);
    assert.deepStrictEqual((await web('GET', '/api/events?from=2026-03-01&to=2026-04-01')), []);
    assert.strictEqual((await dav('GET', `${personal}phone-1.ics`)).status, 404);
    assert.strictEqual((await dav('PUT', `${personal}bad.ics`, { body: 'not a calendar' })).status, 415);
    const todo = 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:t1\r\nSUMMARY:x\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    assert.strictEqual((await dav('PUT', `${personal}t1.ics`, { body: todo })).status, 415);
    const r = await sync(personal, token);
    assert.match(r.text, /phone-1\.ics<\/d:href><d:status>HTTP\/1.1 404/);
    assert.strictEqual((await sync(personal, 'urn:synergy:sync:99999999')).status, 403);
  });
});
