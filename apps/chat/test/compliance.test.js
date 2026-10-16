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

const policy = {
  holds: [{ id: 'h1', name: 'Matter', custodians: [alice], apps: [] }],
  retention: [{ id: 'r1', app: 'chat', kind: 'message', days: 30 }],
  updatedAt: '',
};

test('chat compliance', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `chat_compliance_${process.pid}`;
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

  await boot();
  const general = (await api('GET', '/api/me', { as: alice })).body.channels.find(c => c.name === 'general');
  await api('GET', '/api/me', { as: bob });
  const post = async (as, text, parentId) =>
    (await api('POST', `/api/channels/${general.id}/messages`, { as, body: { body: text, parentId } })).body;
  const a1 = await post(alice, 'The budget for Q3 is final');
  const a2 = await post(alice, 'Budget reply in the thread', a1.id);
  const b1 = await post(bob, 'My budget notes, to be deleted');

  await t.test('needs the token, not a signed-in user', async () => {
    assert.equal((await api('POST', '/api/compliance/search', { body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/search', { as: alice, body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/export', { token: 'wrong', body: { ids: [] } })).status, 401);
  });

  await t.test('rejects bad input', async () => {
    assert.equal((await search({ limit: 'x' })).status, 400);
    assert.equal((await search({ from: 'not a date' })).status, 400);
    assert.equal((await search({ custodians: 'alice' })).status, 400);
    assert.equal((await search({ cursor: '!!' })).status, 400);
    assert.equal((await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: 'x' } })).status, 400);
    const many = Array.from({ length: 101 }, (_, i) => `message:${i}`);
    assert.equal((await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: many } })).status, 400);
  });

  await t.test('search finds messages with owner, participants and snippets', async () => {
    const r = await search({ query: 'budget -notes' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'chat');
    assert.deepEqual(r.body.hits.map(h => h.id).sort(), [`message:${a1.id}`, `message:${a2.id}`].sort());
    const h = r.body.hits.find(x => x.id === `message:${a1.id}`);
    assert.equal(h.owner, alice);
    assert.ok(h.participants.includes(bob));
    assert.equal(h.title, '#general');
    assert.match(h.snippet, /budget for Q3/);
    assert.equal((await search({ query: '"q3 is final" OR nothing' })).body.hits.length, 1);
  });

  await t.test('custodians, kinds, dates and paging', async () => {
    assert.equal((await search({ query: 'budget', custodians: [bob] })).body.total, 3); // bob is a member
    assert.equal((await search({ query: 'budget', custodians: ['nobody@example.com'] })).body.total, 0);
    assert.equal((await search({ kinds: ['file'] })).body.hits.length, 0);
    assert.equal((await search({ query: 'budget', to: '2000-01-01' })).body.total, 0);
    const p1 = await search({ query: 'budget', limit: 2 });
    assert.equal(p1.body.hits.length, 2);
    const p2 = await search({ query: 'budget', limit: 2, cursor: p1.body.nextCursor });
    assert.equal(p2.body.hits.length, 1);
    assert.equal(p2.body.nextCursor, undefined);
  });

  await t.test('a held sender keeps what their edits replace; others do not', async () => {
    const m = await post(alice, 'Original price is 500');
    const n = await post(bob, 'Bob says 700');
    assert.equal((await api('PATCH', `/api/messages/${m.id}`, { as: alice, body: { body: 'Price is TBD' } })).status, 200);
    assert.equal((await api('PATCH', `/api/messages/${n.id}`, { as: bob, body: { body: 'Bob says TBD' } })).status, 200);
    const shown = (await api('GET', `/api/channels/${general.id}/messages`, { as: bob })).body;
    assert.equal(shown.find(x => x.id === m.id).body, 'Price is TBD');
    assert.ok(!JSON.stringify(shown).includes('500'));
    const r = (await search({ query: '500' })).body;
    assert.deepEqual(r.hits.map(h => h.id), [`message:${m.id}`]);
    assert.match(r.hits[0].snippet, /Original price is 500/);
    assert.equal((await search({ query: '700' })).body.total, 0);
    const ex = (await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`message:${m.id}`, `message:${n.id}`] } })).body.items;
    const mine = ex.find(i => i.id === `message:${m.id}`);
    assert.equal(mine.text, 'Price is TBD');
    assert.deepEqual(mine.metadata.previousVersions.map(v => v.body), ['Original price is 500']);
    assert.deepEqual(ex.find(i => i.id === `message:${n.id}`).metadata.previousVersions, []);
  });

  await t.test('a held sender keeps what they delete; others do not', async () => {
    assert.equal((await api('DELETE', `/api/messages/${a1.id}`, { as: alice })).status, 200);
    assert.equal((await api('DELETE', `/api/messages/${b1.id}`, { as: bob })).status, 200);
    const shown = (await api('GET', `/api/channels/${general.id}/messages`, { as: bob })).body;
    assert.equal(shown.find(m => m.id === a1.id).body, '');
    const user = (await api('GET', '/api/search?q=budget', { as: bob })).body;
    assert.ok(!user.some(m => m.id === a1.id));
    const hits = (await search({ query: 'budget' })).body.hits;
    assert.equal(hits.find(h => h.id === `message:${a1.id}`).deleted, true);
    assert.ok(!hits.some(h => h.id === `message:${b1.id}`));
  });

  await t.test('export returns the full text, channel and thread', async () => {
    const r = await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`message:${a1.id}`, `message:${a2.id}`, 'message:999999', 'bogus'] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 2);
    const root = r.body.items.find(i => i.id === `message:${a1.id}`);
    assert.equal(root.app, 'chat');
    assert.equal(root.text, 'The budget for Q3 is final');
    assert.equal(root.deleted, true);
    assert.equal(root.metadata.channel.name, 'general');
    assert.equal(root.metadata.thread.replyCount, 1);
    const reply = r.body.items.find(i => i.id === `message:${a2.id}`);
    assert.equal(reply.metadata.thread.parentId, `message:${a1.id}`);
  });

  await t.test('retention blanks old messages unless the sender is on hold', async () => {
    const old = new Date(Date.now() - 60 * 86400000);
    const ids = {};
    for (const who of [alice, bob]) {
      const u = (await db.q('SELECT id FROM users WHERE email = $1', [who])).rows[0];
      ids[who] = (await db.q(
        'INSERT INTO messages (channel_id, user_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
        [general.id, u.id, `old note from ${who}`, old])).rows[0].id;
    }
    await stop();
    await boot(); // the sweep runs at start
    let bobRow;
    for (let i = 0; i < 40; i++) {
      bobRow = (await db.q('SELECT body, deleted_at, held_body FROM messages WHERE id = $1', [ids[bob]])).rows[0];
      if (bobRow.deleted_at) break;
      await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(bobRow.deleted_at);
    assert.equal(bobRow.body, '');
    assert.equal(bobRow.held_body, null);
    const aliceRow = (await db.q('SELECT body, deleted_at FROM messages WHERE id = $1', [ids[alice]])).rows[0];
    assert.equal(aliceRow.deleted_at, null);
    assert.equal(aliceRow.body, `old note from ${alice}`);
  });
});
