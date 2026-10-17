// Team service routes (Groups -> Chat) against the real server and a real Postgres. Runs when
// TEST_DATABASE_URL is set (CI sets it); skipped otherwise. Each run uses its own throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'test-proxy-secret';
const PORT = 4900 + (process.pid % 500);
const SOURCE = 'groups:0b6f1c3e-2a4d-4f5e-8a9b-1c2d3e4f5a6b';
const ann = 'ann@example.com';
const ben = 'ben@example.com';
const cat = 'cat@example.com';

test('chat team service routes', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `chat_teams_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const db = createDb({ connectionString: dbUrl });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), PROXY_SHARED_SECRET: SECRET,
      SUITE_DOMAIN: 'example.com', NODE_ENV: 'test', DEV_USER_EMAIL: '',
    },
    stdio: 'inherit',
  });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    await db.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch {}
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(up, 'server did not start');

  const svc = async (method, p, body, secret = SECRET) => {
    const headers = { 'content-type': 'application/json' };
    if (secret) headers['x-proxy-auth-secret'] = secret;
    const r = await fetch(`http://127.0.0.1:${PORT}/api/svc${p}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const members = async channelId => (await db.q(
    'SELECT u.email FROM channel_members cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = $1 ORDER BY 1',
    [channelId])).rows.map(r => r.email);
  const wsMembers = async wsId => (await db.q(
    'SELECT u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = $1 ORDER BY 1',
    [wsId])).rows.map(r => r.email);

  const team = {
    name: 'Launch Team',
    members: [{ email: ann, name: 'Ann A', role: 'owner' }, { email: ' BEN@example.com ', role: 'member' }, { email: cat, role: 'member' }],
    channels: [{ key: 'general', name: 'General', topic: 'Everything' }, { key: 'k2', name: 'Design Review' }],
  };
  let first;

  await t.test('refuses without the secret, and bad sources', async () => {
    assert.equal((await svc('PUT', `/teams/${SOURCE}`, team, null)).status, 404);
    assert.equal((await svc('PUT', `/teams/${SOURCE}`, team, 'wrong')).status, 404);
    assert.deepEqual((await svc('GET', `/teams/${SOURCE}/activity`, null, 'wrong')).body, { error: 'Not found' });
    assert.equal((await svc('PUT', '/teams/groups:nope', team)).status, 400);
    assert.equal((await svc('PUT', '/teams/chat:0b6f1c3e-2a4d-4f5e-8a9b-1c2d3e4f5a6b', team)).status, 400);
    assert.equal((await svc('GET', `/teams/${SOURCE}/activity`)).status, 404); // no workspace yet
    assert.equal((await svc('PUT', `/teams/${SOURCE}`, { name: 'x', members: 'no', channels: [] })).status, 400);
    assert.equal((await svc('GET', '/elsewhere')).status, 404);
  });

  await t.test('creates the workspace, channels and members', async () => {
    const r = await svc('PUT', `/teams/${SOURCE}`, team);
    assert.equal(r.status, 200);
    first = r.body;
    assert.equal(first.url, `https://chat.example.com/?ws=${first.workspaceId}`);
    assert.deepEqual(first.channels.map(c => [c.key, c.name]), [['general', 'general'], ['k2', 'design-review']]);
    assert.equal(first.channels[1].url, `https://chat.example.com/?ws=${first.workspaceId}&channel=${first.channels[1].id}`);
    assert.deepEqual(await wsMembers(first.workspaceId), [ann, ben, cat]);
    for (const c of first.channels) assert.deepEqual(await members(c.id), [ann, ben, cat]);
    const users = (await db.q('SELECT email, name FROM users ORDER BY email')).rows;
    assert.deepEqual(users.find(u => u.email === ann).name, 'Ann A');
    assert.deepEqual(users.find(u => u.email === ben).name, 'Ben');
    const ws = (await db.q('SELECT name, source FROM workspaces WHERE id = $1', [first.workspaceId])).rows[0];
    assert.deepEqual(ws, { name: 'Launch Team', source: SOURCE });
  });

  await t.test('re-PUT renames and removes a member everywhere', async () => {
    // Someone outside the team in a non-source channel of the workspace, and cat in it too.
    const extra = (await db.q(
      `INSERT INTO channels (kind, name, workspace_id) VALUES ('public', 'random', $1) RETURNING id`, [first.workspaceId])).rows[0];
    await db.q(
      `INSERT INTO channel_members (channel_id, user_id) SELECT $1, id FROM users WHERE email IN ($2, $3)`, [extra.id, cat, ann]);
    const r = await svc('PUT', `/teams/${SOURCE}`, {
      ...team, name: 'Launch Crew',
      members: team.members.filter(m => m.email !== cat),
      channels: [{ key: 'general', name: 'General' }, { key: 'k2', name: 'random' }],
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.workspaceId, first.workspaceId);
    assert.deepEqual(r.body.channels.map(c => c.id), first.channels.map(c => c.id));
    assert.equal(r.body.channels[1].name, 'random-2'); // de-duplicated against the existing #random
    assert.equal((await db.q('SELECT name FROM workspaces WHERE id = $1', [first.workspaceId])).rows[0].name, 'Launch Crew');
    assert.deepEqual(await wsMembers(first.workspaceId), [ann, ben]);
    for (const c of first.channels) assert.deepEqual(await members(c.id), [ann, ben]);
    assert.deepEqual(await members(extra.id), [ann]);
    // Topic kept when not sent.
    assert.equal((await db.q('SELECT topic FROM channels WHERE id = $1', [first.channels[0].id])).rows[0].topic, 'Everything');
  });

  await t.test('posts as a member and lists activity', async () => {
    const p = await svc('POST', `/teams/${SOURCE}/messages`, { channelKey: 'k2', email: 'Ann@Example.com', body: ' Hello team ' });
    assert.equal(p.status, 200);
    assert.equal(p.body.body, 'Hello team');
    assert.equal(Number(p.body.channel_id), first.channels[1].id);
    await svc('POST', `/teams/${SOURCE}/messages`, { channelKey: 'general', email: ben, body: 'Second' });
    assert.equal((await svc('POST', `/teams/${SOURCE}/messages`, { channelKey: 'general', email: cat, body: 'x' })).status, 403);
    assert.equal((await svc('POST', `/teams/${SOURCE}/messages`, { channelKey: 'nope', email: ann, body: 'x' })).status, 404);
    assert.equal((await svc('POST', `/teams/${SOURCE}/messages`, { channelKey: 'general', email: ann, body: '  ' })).status, 400);

    const a = await svc('GET', `/teams/${SOURCE}/activity?limit=1`);
    assert.equal(a.status, 200);
    assert.equal(a.body.messages.length, 1);
    const m = a.body.messages[0];
    assert.equal(m.body, 'Second');
    assert.equal(m.channelKey, 'general');
    assert.equal(m.channelName, 'general');
    assert.deepEqual(m.author, { email: ben, name: 'Ben' });
    assert.equal(m.replyCount, 0);
    assert.match(m.url, new RegExp(`/\\?ws=${first.workspaceId}&channel=${first.channels[0].id}&msg=${m.id}$`));
    assert.deepEqual((await svc('GET', `/teams/${SOURCE}/activity`)).body.messages.map(x => x.body), ['Second', 'Hello team']);
  });

  await t.test('delete removes everyone and keeps messages; ok when absent', async () => {
    assert.deepEqual((await svc('DELETE', `/teams/${SOURCE}`)).body, { ok: true });
    assert.deepEqual(await wsMembers(first.workspaceId), []);
    for (const c of first.channels) assert.deepEqual(await members(c.id), []);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM messages')).rows[0].n, 2);
    assert.deepEqual((await svc('DELETE', '/teams/groups:00000000-0000-0000-0000-000000000000')).body, { ok: true });
  });
});
