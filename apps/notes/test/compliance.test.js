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
const carol = 'carol@example.com';   // only ever comments

const policy = {
  holds: [{ id: 'h1', name: 'Matter', custodians: [alice], apps: ['notes'] }],
  retention: [],
  updatedAt: '',
};

test('notes compliance', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `notes_compliance_${process.pid}`;
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

  const api = async (method, p, { as, token, body, raw, type } = {}) => {
    const headers = { 'content-type': type || 'application/json' };
    if (as) headers['x-dev-user'] = as;
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: raw || (body && JSON.stringify(body)) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const search = body => api('POST', '/api/compliance/search', { token: TOKEN, body });

  await boot();
  const parent = (await api('POST', '/api/pages', { as: alice, body: { title: 'Projects' } })).body;
  const page = (await api('POST', '/api/pages', { as: alice, body: { title: 'Atlas plan', parentId: parent.id, body: '# Atlas\n\nThe **acquisition** closes in May.' } })).body;
  await api('PATCH', `/api/pages/${page.id}`, { as: bob, body: { body: '# Atlas\n\nThe **acquisition** closes in June.' } });
  const other = (await api('POST', '/api/pages', { as: bob, body: { title: 'Bob scratch', body: 'acquisition ideas' } })).body;

  await t.test('needs the token, not a signed-in user', async () => {
    assert.equal((await api('POST', '/api/compliance/search', { body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/search', { as: alice, body: {} })).status, 401);
    assert.equal((await api('POST', '/api/compliance/export', { token: 'wrong', body: { ids: [] } })).status, 401);
  });

  await t.test('rejects bad input', async () => {
    assert.equal((await search({ limit: 1.5 })).status, 400);
    assert.equal((await search({ from: 12 })).status, 400);
    assert.equal((await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: null } })).status, 400);
  });

  await t.test('search finds pages with owner, editors and plain-text snippets', async () => {
    const r = await search({ query: 'acquisition june' });
    assert.equal(r.status, 200);
    assert.equal(r.body.app, 'notes');
    assert.deepEqual(r.body.hits.map(h => h.id), [`page:${page.id}`]);
    const h = r.body.hits[0];
    assert.equal(h.owner, alice);
    assert.deepEqual(h.participants, [bob]);
    assert.equal(h.snippet, 'Atlas The acquisition closes in June.');
    assert.equal((await search({ query: 'acquisition', custodians: [bob] })).body.total, 2);
    assert.equal((await search({ query: 'acquisition', custodians: [alice] })).body.total, 1);
    assert.equal((await search({ query: 'acquisition', kinds: ['page'], to: '2000-01-01' })).body.total, 0);
    assert.equal((await search({ kinds: ['message'] })).body.total, 0);
    const p1 = await search({ query: 'acquisition', limit: 1 });
    assert.equal((await search({ query: 'acquisition', limit: 1, cursor: p1.body.nextCursor })).body.hits.length, 1);
  });

  await t.test('under a hold, quick successive edits are separate versions and stay searchable', async () => {
    await api('PATCH', `/api/pages/${page.id}`, { as: bob, body: { body: '# Atlas\n\nThe **acquisition** closes in July.' } });
    await api('PATCH', `/api/pages/${other.id}`, { as: bob, body: { body: 'acquisition ideas, v2' } });
    await api('PATCH', `/api/pages/${other.id}`, { as: bob, body: { body: 'acquisition ideas, v3' } });
    const count = id => db.q('SELECT count(*)::int AS n FROM page_versions WHERE page_id = $1', [id]).then(r => r.rows[0].n);
    assert.equal(await count(page.id), 2);    // alice's page: bob's second edit did not fold into his first
    assert.equal(await count(other.id), 1);   // nobody on hold: folded as before
    const r = (await search({ query: 'june' })).body;
    assert.deepEqual(r.hits.map(h => h.id), [`page:${page.id}`]);
    assert.match(r.hits[0].snippet, /closes in June/);
  });

  // Attachments and comments: the app's permanent deletes.
  const upload = (as, name, text) => api('POST', `/api/pages/${page.id}/attachments?name=${name}`, { as, raw: text, type: 'text/plain' });
  const keepFile = (await upload(bob, 'terms.txt', 'secret terms')).body;   // on alice's page: kept
  const dropFile = (await upload(bob, 'scratch.txt', 'nothing')).body;
  const otherFile = (await api('POST', `/api/pages/${other.id}/attachments?name=x.txt`, { as: bob, raw: 'x', type: 'text/plain' })).body;
  const comment = (await api('POST', `/api/pages/${page.id}/comments`, { as: bob, body: { body: 'Check with @alice@example.com' } })).body;
  const otherComment = (await api('POST', `/api/pages/${other.id}/comments`, { as: bob, body: { body: 'gone' } })).body;

  await t.test('deletes keep what a hold covers, hidden from the app', async () => {
    await api('DELETE', `/api/attachments/${keepFile.id}`, { as: bob });
    await api('DELETE', `/api/attachments/${otherFile.id}`, { as: bob });
    await api('DELETE', `/api/comments/${comment.id}`, { as: bob });
    await api('DELETE', `/api/comments/${otherComment.id}`, { as: bob });
    const shown = (await api('GET', `/api/pages/${page.id}`, { as: alice })).body;
    assert.deepEqual(shown.attachments.map(a => a.filename), ['scratch.txt']);
    assert.deepEqual((await api('GET', `/api/pages/${page.id}/comments`, { as: alice })).body, []);
    assert.equal((await api('GET', `/api/attachments/${keepFile.id}`, { as: alice })).status, 404);
    assert.equal((await api('GET', '/api/notifications', { as: alice })).body.unread, 0);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM attachments WHERE id = $1', [otherFile.id])).rows[0].n, 0);
    assert.equal((await db.q('SELECT count(*)::int AS n FROM comments WHERE id = $1', [otherComment.id])).rows[0].n, 0);
    assert.ok(dropFile.id);
  });

  // Comment edits: carol writes a comment on alice's page, then she and bob each reword it.
  const note = (await api('POST', `/api/pages/${page.id}/comments`, { as: carol, body: { body: 'Budget is 5 million' } })).body;
  const versionsOf = id => db.q('SELECT count(*)::int AS n FROM comment_versions WHERE comment_id = $1', [id]).then(r => r.rows[0].n);

  await t.test('editing a comment keeps every earlier text, searchable by keyword and custodian', async () => {
    await api('PATCH', `/api/comments/${note.id}`, { as: carol, body: { body: 'Budget is 6 million' } });
    const edited = (await api('PATCH', `/api/comments/${note.id}`, { as: bob, body: { body: 'Budget is 7 million' } })).body;
    assert.equal(edited.body, 'Budget is 7 million');
    assert.equal(edited.edited_by, bob);
    // Resolving, or saving the same text, is not an edit.
    await api('PATCH', `/api/comments/${note.id}`, { as: carol, body: { resolved: true } });
    await api('PATCH', `/api/comments/${note.id}`, { as: carol, body: { body: 'Budget is 7 million' } });
    assert.equal(await versionsOf(note.id), 2);
    assert.equal((await api('GET', `/api/pages/${page.id}/comments`, { as: alice })).body[0].body, 'Budget is 7 million');

    const old = (await search({ query: '"5 million"' })).body;
    assert.deepEqual(old.hits.map(h => h.id), [`page:${page.id}`]);
    assert.match(old.hits[0].snippet, /^Budget is 5 million/);
    const now = (await search({ query: '"7 million"' })).body;
    assert.deepEqual(now.hits.map(h => h.id), [`page:${page.id}`]);
    assert.match(now.hits[0].snippet, /Budget is 7 million/);
    const byCarol = (await search({ custodians: [carol] })).body;
    assert.deepEqual(byCarol.hits.map(h => h.id), [`page:${page.id}`]);
    assert.ok(byCarol.hits[0].participants.includes(carol));
  });

  await t.test("a held delete keeps a comment's history; a real delete removes it", async () => {
    await api('DELETE', `/api/comments/${note.id}`, { as: carol });   // alice's page: kept
    assert.equal((await db.q('SELECT count(*)::int AS n FROM comments WHERE id = $1 AND held_deleted_at IS NOT NULL', [note.id])).rows[0].n, 1);
    assert.equal(await versionsOf(note.id), 2);
    assert.equal((await search({ query: '"6 million"' })).body.total, 1);

    const scratch = (await api('POST', `/api/pages/${other.id}/comments`, { as: bob, body: { body: 'first draft' } })).body;
    await api('PATCH', `/api/comments/${scratch.id}`, { as: bob, body: { body: 'second draft' } });
    assert.equal(await versionsOf(scratch.id), 1);
    await api('DELETE', `/api/comments/${scratch.id}`, { as: bob });   // nobody on hold: gone
    assert.equal(await versionsOf(scratch.id), 0);
  });

  await t.test('export has markdown, html, path, revisions, comments and attachments', async () => {
    await api('DELETE', `/api/pages/${page.id}`, { as: alice });   // to the trash
    const r = await api('POST', '/api/compliance/export', { token: TOKEN, body: { ids: [`page:${page.id}`, 'page:99999'] } });
    assert.equal(r.body.items.length, 1);
    const it = r.body.items[0];
    assert.equal(it.app, 'notes');
    assert.equal(it.deleted, true);
    assert.match(it.text, /closes in July/);
    assert.match(it.html, /<strong>acquisition<\/strong>/);
    assert.deepEqual(it.metadata.path, ['General', 'Projects', 'Atlas plan']);
    assert.equal(it.metadata.revisions, 2);   // creating a page is not a version; bob's edits are
    assert.equal(it.metadata.previousVersions.length, 1);
    assert.match(it.metadata.previousVersions[0].body, /closes in June/);
    assert.equal(it.metadata.comments.length, 2);
    assert.ok(it.metadata.comments.every(c => c.deletedAt));
    const first = it.metadata.comments.find(c => c.id === Number(comment.id));
    assert.deepEqual([first.edits, first.editedBy, first.editedAt], [[], null, null]);
    const budget = it.metadata.comments.find(c => c.id === Number(note.id));
    assert.equal(budget.author, carol);
    assert.equal(budget.body, 'Budget is 7 million');
    assert.equal(budget.editedBy, bob);
    assert.ok(budget.editedAt);
    assert.deepEqual(budget.edits.map(e => [e.body, e.editedBy]),
      [['Budget is 5 million', carol], ['Budget is 6 million', carol]]);
    assert.ok(budget.edits.every(e => e.editedAt));
    assert.ok(new Date(budget.edits[0].editedAt) <= new Date(budget.edits[1].editedAt));
    const terms = it.attachments.find(a => a.name === 'terms.txt');
    assert.equal(Buffer.from(terms.base64, 'base64').toString(), 'secret terms');
    assert.equal(it.attachments.length, 2);
  });
});
