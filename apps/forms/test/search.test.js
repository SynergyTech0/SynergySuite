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

test('forms suite search', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `forms_search_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();

  const policyServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ holds: [{ id: 'h1', name: 'Matter', custodians: [alice], apps: ['forms'] }], retention: [], updatedAt: '' }));
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

  const form = async (as, b) => (await api('POST', '/api/forms', { as, body: b })).body;
  const fields = [{ label: 'Name', type: 'text' }, { label: 'Email', type: 'email' }, { label: 'Favourite fruit', type: 'select', options: ['Kiwi', 'Mango'] }];
  const survey = await form(alice, { title: 'Fruit survey', description: 'Tell us about kiwi season', fields });
  await api('PATCH', `/api/forms/${survey.id}`, { as: alice, body: { published: true } });
  const submit = async (slug, data) => fetch(`http://127.0.0.1:${PORT}/f/${slug}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  assert.equal((await submit(survey.slug, { f0: 'Dana', f1: 'dana@example.com', f2: 'Kiwi' })).status, 200);
  const bobs = await form(bob, { title: 'Bob intake', description: 'kiwi orders', fields });
  const gone = await form(alice, { title: 'Kiwi old form', fields });
  await api('DELETE', `/api/forms/${gone.id}`, { as: alice });   // alice is on hold: kept, hidden
  const responseId = (await api('GET', `/api/forms/${survey.id}/submissions`, { as: alice })).body[0].id;

  const ids = r => r.body.results.map(x => x.id).sort();

  await t.test('finds my forms (title, description, questions) and their responses, newest first', async () => {
    const r = await search(alice, { query: 'kiwi', kinds: ['form', 'response'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'forms');
    assert.deepEqual(ids(r), [`form:${survey.id}`, `form:${bobs.id}`, `response:${responseId}`].sort());
    const dates = r.body.results.map(x => x.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    const f = r.body.results.find(x => x.id === `form:${survey.id}`);
    assert.equal(f.kind, 'form');
    assert.equal(f.title, 'Fruit survey');
    assert.equal(f.person, alice);
    assert.equal(f.url, `/?form=${survey.id}`);
    assert.deepEqual(ids(await search(alice, { query: 'favourite', kinds: ['form'] })), [`form:${bobs.id}`, `form:${survey.id}`].sort());
    const resp = r.body.results.find(x => x.kind === 'response');
    assert.equal(resp.title, 'Response to Fruit survey');
    assert.equal(resp.person, 'dana@example.com');
    assert.equal(resp.url, `/?form=${survey.id}&responses=1`);
    assert.match(resp.snippet, /Favourite fruit: Kiwi/);
  });

  await t.test('never returns forms (or their responses) deleted while on hold', async () => {
    assert.equal((await search(alice, { query: 'old form' })).body.results.length, 0);
    assert.equal((await search(bob, { query: 'old form' })).body.results.length, 0);
  });

  await t.test("returns forms shared with the person: every live form is open to edit in the app", async () => {
    assert.deepEqual(ids(await search(bob, { query: 'season' })), [`form:${survey.id}`]);
    assert.deepEqual(ids(await search(bob, { query: 'dana' })), [`response:${responseId}`]);
  });

  await t.test('kinds, limit and text', async () => {
    assert.deepEqual(ids(await search(alice, { query: 'kiwi', kinds: ['response'] })), [`response:${responseId}`]);
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['event'] })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'kiwi', limit: 1 })).body.results.length, 1);
    const r = await search(alice, { query: 'dana', text: true });
    assert.match(r.body.results[0].text, /Name: Dana Email: dana@example.com Favourite fruit: Kiwi/);
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
