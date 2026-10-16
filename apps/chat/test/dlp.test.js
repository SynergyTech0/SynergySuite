// Data loss prevention on posting and editing, against the real server and a real Postgres, with
// a fake Admin center that serves DLP rules and records the incidents Chat reports. Runs when
// TEST_DATABASE_URL is set (CI sets it); skipped otherwise. Each run uses its own throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const PORT = 4800 + (process.pid % 500);
const alice = 'alice@example.com';
const bob = 'bob@example.com';
const guest = 'guest@partner.test';

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const CARD = '4111 1111 1111 1111';
const SSN = '123-45-6789';
const IBAN = 'GB82 WEST 1234 5698 7654 32';

const rule = (id, over) => ({ id, name: id, enabled: true, mode: 'enforce', apps: [], labels: [], scope: 'anyone', ...over });
const policy = {
  holds: [],
  retention: [],
  updatedAt: '',
  dlp: {
    internalDomains: ['example.com'],
    types: [],
    rules: [
      rule('keys', { types: [{ type: 'credentials', min: 1 }], action: 'block', tip: 'No secrets in chat.' }),
      rule('cards', { types: [{ type: 'credit-card', min: 1 }], action: 'warn', tip: 'Card numbers belong in the payments system.' }),
      rule('ssn-out', { types: [{ type: 'us-ssn', min: 1 }], scope: 'external', action: 'block' }),
      rule('iban-trial', { types: [{ type: 'iban', min: 1 }], mode: 'test', action: 'block' }),
      rule('other-app', { apps: ['mail'], types: [{ type: 'credit-card', min: 1 }], action: 'block' }),
    ],
  },
};

test('chat data loss prevention', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `chat_dlp_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
  const db = createDb({ connectionString: dbUrl });

  const incidents = [];
  const policyServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/api/svc/dlp/incidents') {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => { incidents.push(JSON.parse(raw)); res.end('{}'); });
      return;
    }
    res.end(JSON.stringify(policy));
  });
  await new Promise(r => policyServer.listen(0, '127.0.0.1', r));

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: {
      ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), DEV_USER_EMAIL: 'ci@example.com',
      COMPLIANCE_TOKEN: 'test-compliance-token', ADMIN_INTERNAL_URL: `http://127.0.0.1:${policyServer.address().port}`,
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
  });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    policyServer.close();
    await db.close();
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) break; } catch {}
    if (i > 60) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 250));
  }

  const api = async (method, p, { as, body } = {}) => {
    const headers = { 'content-type': 'application/json', 'x-dev-user': as };
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  // Incidents are reported in the background; wait for the next one.
  const nextIncident = async () => {
    const seen = incidents.length;
    for (let i = 0; i < 40 && incidents.length === seen; i++) await new Promise(r => setTimeout(r, 50));
    return incidents[incidents.length - 1];
  };
  const settle = () => new Promise(r => setTimeout(r, 300));

  const me = (await api('GET', '/api/me', { as: alice })).body;
  const general = me.channels.find(c => c.name === 'general');
  await api('GET', '/api/me', { as: bob });
  const guestMe = (await api('GET', '/api/me', { as: guest })).body.me;
  // The guest isn't in #general's room for these checks: only colleagues are.
  await api('POST', `/api/channels/${general.id}/leave`, { as: guest });
  const post = (as, text, extra = {}) => api('POST', `/api/channels/${general.id}/messages`, { as, body: { body: text, ...extra } });
  const texts = async () => (await api('GET', `/api/channels/${general.id}/messages`, { as: alice })).body.map(m => m.body);

  await t.test('ordinary messages go through and report nothing', async () => {
    const r = await post(alice, 'Lunch at noon?');
    assert.equal(r.status, 200);
    await settle();
    assert.equal(incidents.length, 0);
  });

  await t.test('a blocked message is refused, not saved, and reported', async () => {
    const r = await post(alice, `the key is ${AWS_KEY}`);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'No secrets in chat.');
    assert.equal(r.body.dlp.action, 'block');
    assert.deepEqual(r.body.dlp.matches.map(m => m.type), ['credentials']);
    assert.ok(!(await texts()).some(x => x.includes(AWS_KEY)));
    const inc = await nextIncident();
    assert.equal(inc.app, 'chat');
    assert.equal(inc.actor, alice);
    assert.equal(inc.title, 'Message in #general');
    assert.equal(inc.action, 'block');
    assert.equal(inc.target, undefined);
    assert.deepEqual(inc.rules.map(x => x.id), ['keys']);
    assert.deepEqual(inc.matches, [{ type: 'credentials', name: 'Passwords, keys and access tokens', count: 1 }]);
    assert.ok(inc.recipients.includes(bob));
    assert.ok(!inc.recipients.includes(alice));
    // Overriding doesn't get past a block.
    assert.equal((await post(alice, `the key is ${AWS_KEY}`, { dlpOverride: { justification: 'please' } })).status, 422);
  });

  await t.test('a warning needs a reason, then sends and reports the override', async () => {
    const r = await post(bob, `card ${CARD}`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Card numbers belong in the payments system.');
    assert.equal(r.body.dlp.action, 'warn');
    assert.equal((await nextIncident()).overridden, undefined);
    assert.equal((await post(bob, `card ${CARD}`, { dlpOverride: { justification: '  ' } })).status, 409);
    const ok = await post(bob, `card ${CARD}`, { dlpOverride: { justification: 'Customer asked for a refund' } });
    assert.equal(ok.status, 200);
    let inc;
    for (let i = 0; i < 40 && !(inc = incidents.find(x => x.target === `message:${ok.body.id}`)); i++) await new Promise(res => setTimeout(res, 50));
    assert.equal(inc.action, 'warn');
    assert.equal(inc.overridden, true);
    assert.equal(inc.justification, 'Customer asked for a refund');
    assert.equal(inc.actor, bob);
  });

  await t.test('external-only rules apply when someone outside is in the conversation', async () => {
    assert.equal((await post(alice, `SSN ${SSN}`)).status, 200);
    await settle();
    assert.ok(!incidents.some(x => x.rules.some(r => r.id === 'ssn-out')));
    const dm = (await api('POST', '/api/dms', { as: alice, body: { userId: guestMe.id, workspaceId: me.activeWorkspace } })).body;
    const r = await api('POST', `/api/channels/${dm.id}/messages`, { as: alice, body: { body: `SSN ${SSN}` } });
    assert.equal(r.status, 422);
    assert.equal(r.body.dlp.external, true);
    assert.deepEqual(r.body.dlp.outside, [guest]);
    const inc = await nextIncident();
    assert.equal(inc.title, `Message in a direct message to ${guest}`);
    assert.deepEqual(inc.recipients, [guest]);
  });

  await t.test('test-mode rules only audit: the message is saved and reported', async () => {
    const r = await post(alice, `wire to ${IBAN}`);
    assert.equal(r.status, 200);
    const inc = await nextIncident();
    assert.equal(inc.action, 'audit');
    assert.equal(inc.target, `message:${r.body.id}`);
    assert.deepEqual(inc.rules, [{ id: 'iban-trial', name: 'iban-trial', action: 'audit', mode: 'test' }]);
  });

  await t.test('replies and edits are checked too', async () => {
    const root = (await post(alice, 'Thread root')).body;
    const reply = await post(bob, `card ${CARD}`, { parentId: root.id });
    assert.equal(reply.status, 409);
    assert.equal((await nextIncident()).title, 'Reply in #general');

    const edit = await api('PATCH', `/api/messages/${root.id}`, { as: alice, body: { body: `oops ${AWS_KEY}` } });
    assert.equal(edit.status, 422);
    const inc = await nextIncident();
    assert.equal(inc.title, 'Edited message in #general');
    assert.equal((await db.q('SELECT body FROM messages WHERE id = $1', [root.id])).rows[0].body, 'Thread root');

    const warned = await api('PATCH', `/api/messages/${root.id}`, { as: alice, body: { body: `card ${CARD}`, dlpOverride: { justification: 'test card' } } });
    assert.equal(warned.status, 200);
    assert.equal(warned.body.body, `card ${CARD}`);
    // Someone else's message is still not found, before any check.
    assert.equal((await api('PATCH', `/api/messages/${root.id}`, { as: bob, body: { body: 'hi' } })).status, 404);
  });
});
