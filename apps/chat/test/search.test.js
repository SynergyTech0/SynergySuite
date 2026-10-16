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

test('chat suite search', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `chat_search_${process.pid}`;
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

  const me = (await api('GET', '/api/me', { as: alice })).body;
  await api('GET', '/api/me', { as: bob });
  await api('GET', '/api/me', { as: carol });
  const ws = me.activeWorkspace;
  const general = me.channels.find(c => c.name === 'general');
  const users = (await api('GET', '/api/me', { as: alice })).body.users;
  const bobId = users.find(u => u.email === bob).id;
  const post = async (as, ch, text, parentId) =>
    (await api('POST', `/api/channels/${ch}/messages`, { as, body: { body: text, parentId } })).body;

  const pub = await post(alice, general.id, 'Kiwi launch plan for everyone');
  const reply = await post(bob, general.id, 'Kiwi reply in the thread', pub.id);
  const secret = (await api('POST', '/api/channels', { as: alice, body: { name: 'secret', kind: 'private', workspaceId: ws } })).body;
  const priv = await post(alice, secret.id, 'Kiwi private numbers');
  const dm = (await api('POST', '/api/dms', { as: alice, body: { userId: bobId, workspaceId: ws } })).body;
  const dmMsg = await post(alice, dm.id, 'Kiwi just between us');
  const gone = await post(alice, general.id, 'Kiwi typo to delete');
  await api('DELETE', `/api/messages/${gone.id}`, { as: alice });

  const ids = r => r.body.results.map(x => x.id).sort();

  await t.test('finds my own messages, in every channel and DM I am in, newest first', async () => {
    const r = await search(alice, { query: 'kiwi' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'chat');
    assert.deepEqual(ids(r), [pub, reply, priv, dmMsg].map(m => `message:${m.id}`).sort());
    const dates = r.body.results.map(x => x.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    const h = r.body.results.find(x => x.id === `message:${priv.id}`);
    assert.equal(h.kind, 'message');
    assert.equal(h.title, '#secret');
    assert.match(h.snippet, /Kiwi private numbers/);
    assert.equal(h.url, `/?ws=${ws}&channel=${secret.id}&msg=${priv.id}`);
    assert.equal(h.text, undefined);
    const rh = r.body.results.find(x => x.id === `message:${reply.id}`);
    assert.equal(rh.url, `/?ws=${ws}&channel=${general.id}&msg=${reply.id}&thread=${pub.id}`);
    assert.match(rh.title, /thread reply/);
  });

  await t.test('never returns a private channel or DM the person is not in, or deleted messages', async () => {
    assert.deepEqual(ids(await search(bob, { query: 'kiwi' })), [pub, reply, dmMsg].map(m => `message:${m.id}`).sort());
    assert.deepEqual(ids(await search(carol, { query: 'kiwi' })), [pub, reply].map(m => `message:${m.id}`).sort());
    assert.equal((await search(alice, { query: 'typo' })).body.results.length, 0);
  });

  await t.test('returns what is shared: a DM and a channel the person was invited to', async () => {
    const d = (await search(bob, { query: 'between' })).body.results;
    assert.equal(d.length, 1);
    assert.equal(d[0].title, 'DM with Alice');
    const carolId = users.find(u => u.email === carol).id;
    await api('POST', `/api/channels/${secret.id}/invite`, { as: alice, body: { userId: carolId } });
    assert.deepEqual(ids(await search(carol, { query: 'private' })), [`message:${priv.id}`]);
  });

  await t.test('kinds, limit and text', async () => {
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['file'] })).body.results.length, 0);
    assert.equal((await search(alice, { query: 'kiwi', kinds: ['message'], limit: 2 })).body.results.length, 2);
    const r = await search(alice, { query: 'kiwi -thread', text: true });
    assert.ok(r.body.results.every(x => typeof x.text === 'string' && !/thread/i.test(x.text)));
  });

  await t.test('needs the gateway identity', async () => {
    assert.equal((await api('POST', '/api/search', { body: { query: 'kiwi' } })).status, 401);
    assert.equal((await api('POST', '/api/search', { as: alice, secret: 'wrong', body: { query: 'kiwi' } })).status, 401);
  });

  await t.test('400 on an empty query', async () => {
    const r = await search(alice, { query: '  ' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
    assert.equal((await search(alice, {})).status, 400);
  });
});
