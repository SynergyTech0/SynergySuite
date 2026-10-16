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
const carol = 'carol@example.com';   // a respondent

const policy = {
  holds: [{ id: 'h1', name: 'Matter', custodians: [alice], apps: ['forms'] }],
  retention: [{ id: 'r1', app: 'forms', kind: 'response', days: 30 }, { id: 'r2', app: 'forms', kind: 'form', days: 90 }],
  updatedAt: '',
};

test('forms compliance', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `forms_compliance_${process.pid}`;
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

  const api = async (method, p, { as, token, body, form } = {}) => {
    const headers = { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' };
    if (as) headers['x-dev-user'] = as;
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method, headers, body: form ? new URLSearchParams(form).toString() : body && JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text };
  };
  const search = body => api('POST', '/api/compliance/search', { token: TOKEN, body });
  const makeForm = async (as, title) => {
    const f = (await api('POST', '/api/forms', { as, body: { title, description: `About ${title}`, fields: [
      { label: 'Your email', type: 'email', required: true }, { label: 'Comments', type: 'textarea' },
    ] } })).body;
    await api('PATCH', `/api/forms/${f.id}`, { as, body: { published: true } });
    return f;
  };
  const respond = (slug, email, comments) => api('POST', `/f/${slug}`, { form: { f0: email, f1: comments } });

  await boot();
  const fa = await makeForm(alice, 'Incident report');
  const fb = await makeForm(bob, 'Lunch survey');
  assert.equal((await respond(fa.slug, carol, 'The server room flooded')).status, 200);
  assert.equal((await respond(fb.slug, 'Dave@Example.com', 'More tacos please')).status, 200);
  const subA = (await api('GET', `/api/forms/${fa.id}/submissions`, { as: alice })).body[0];

  await t.test('needs the token, not a signed-in user', async () => {
    assert.equal((await api('POST', '/api/compliance/search', { body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/search', { as: alice, body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/export', { token: 'wrong', body: { ids: [] } })).status, 401);
  });

  await t.test('rejects bad input', async () => {
    assert.equal((await search([])).status, 400);
    assert.equal((await search({ query: 5 })).status, 400);
    assert.equal((await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [1] } })).status, 400);
  });

  await t.test('search covers forms and responses', async () => {
    const r = await search({ query: 'flooded' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'forms');
    assert.deepEqual(r.body.hits.map(h => h.id), [`response:${subA.id}`]);
    const h = r.body.hits[0];
    assert.equal(h.kind, 'response');
    assert.equal(h.owner, alice);
    assert.deepEqual(h.participants, [carol]);
    assert.match(h.snippet, /Comments: The server room flooded/);
    assert.deepEqual((await search({ query: 'incident', kinds: ['form'] })).body.hits.map(h => h.id), [`form:${fa.id}`]);
    assert.equal((await search({ kinds: ['response'] })).body.total, 2);
    assert.equal((await search({ kinds: ['event'] })).body.total, 0);
    assert.equal((await search({ custodians: ['dave@example.com'] })).body.total, 1);  // as respondent
    assert.equal((await search({ custodians: [alice] })).body.total, 2);              // form + its response
    assert.equal((await search({ from: '2999-01-01' })).body.total, 0);
    const p1 = await search({ limit: 3 });
    assert.equal(p1.body.total, 4);
    assert.equal((await search({ limit: 3, cursor: p1.body.nextCursor })).body.hits.length, 1);
  });

  await t.test('answers to fields removed by an edit stay searchable', async () => {
    await api('PATCH', `/api/forms/${fb.id}`, { as: bob, body: { fields: [{ label: 'Your email', type: 'email' }] } });
    const r = (await search({ query: 'tacos' })).body;
    assert.equal(r.total, 1);
    assert.match(r.hits[0].snippet, /f1: More tacos please/);
  });

  await t.test('a held owner keeps the forms they delete; others do not', async () => {
    await api('DELETE', `/api/forms/${fa.id}`, { as: alice });
    await api('DELETE', `/api/forms/${fb.id}`, { as: bob });
    assert.deepEqual((await api('GET', '/api/forms', { as: alice })).body, []);
    assert.equal((await api('GET', `/api/forms/${fa.id}`, { as: alice })).status, 404);
    assert.equal((await api('GET', `/api/forms/${fa.id}/submissions`, { as: alice })).status, 404);
    assert.equal((await api('GET', `/f/${fa.slug}`)).status, 404);
    const hits = (await search({})).body.hits;
    assert.deepEqual(hits.map(h => `${h.id}:${h.deleted}`).sort(), [`form:${fa.id}:true`, `response:${subA.id}:true`]);
    // The slug is free again for a new form with the same title.
    assert.equal((await api('POST', '/api/forms', { as: alice, body: { title: 'Incident report' } })).status, 200);
  });

  await t.test('export returns answers and form details', async () => {
    const r = await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`form:${fa.id}`, `response:${subA.id}`, `form:${fb.id}`] } });
    assert.equal(r.body.items.length, 2);
    const form = r.body.items.find(i => i.kind === 'form');
    assert.equal(form.metadata.slug, 'incident-report');
    assert.equal(form.metadata.responses, 1);
    assert.equal(form.deleted, true);
    const resp = r.body.items.find(i => i.kind === 'response');
    assert.equal(resp.app, 'forms');
    assert.equal(resp.metadata.answers.f1, 'The server room flooded');
    assert.equal(resp.metadata.form.id, `form:${fa.id}`);
    assert.match(resp.text, /Your email: carol@example.com/);
  });

  await t.test('retention removes old responses and forms unless the owner is on hold', async () => {
    const fc = await makeForm(bob, 'Old survey');
    const fd = await makeForm(alice, 'Old held survey');
    await respond(fc.slug, carol, 'old answer');
    await respond(fd.slug, carol, 'old held answer');
    await db.q(`UPDATE submissions SET submitted_at = now() - interval '60 days'`);
    await db.q(`UPDATE forms SET updated_at = now() - interval '120 days' WHERE id = ANY($1::bigint[])`, [[fc.id, fd.id]]);
    await stop();
    await boot(); // the sweep runs at start
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      gone = (await db.q('SELECT 1 FROM forms WHERE id = $1', [fc.id])).rows.length === 0;
      if (!gone) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(gone);
    const kept = (await db.q('SELECT held_deleted_at FROM forms WHERE id = $1', [fd.id])).rows[0];
    assert.equal(kept.held_deleted_at, null);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM submissions WHERE form_id = $1', [fd.id])).rows[0].n, 1);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM submissions WHERE form_id = $1', [fa.id])).rows[0].n, 1);
  });
});
