// Private team sites, permissions, group sites, document libraries in Drive, search and compliance,
// against the real server and a real Postgres. Runs when TEST_DATABASE_URL is set; skipped
// otherwise. Groups come from test/fixtures/fake-groups.js; Drive and the Admin center are faked
// over HTTP here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createDb } = require('@synergy/db');

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'test-proxy-secret';
const PORT = 5300 + (process.pid % 500);
const [alice, bob, carol, dan, erin, held] =
  ['alice', 'bob', 'carol', 'dan', 'erin', 'held'].map(n => `${n}@example.com`);

/** A tiny HTTP server answering `handler(req, body)` with JSON; resolves to its base URL. */
function fakeServer(handler) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const { status = 200, body = {} } = handler(req, raw ? JSON.parse(raw) : undefined) || {};
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test('team sites', { skip: !url && 'TEST_DATABASE_URL not set' }, async t => {
  const name = `sites_access_${process.pid}`;
  const admin = createDb({ connectionString: url });
  await admin.q(`DROP DATABASE IF EXISTS ${name}`);
  await admin.q(`CREATE DATABASE ${name}`);
  const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();

  // A site from before permissions existed: no members yet, owned by whoever made it.
  const old = createDb({ connectionString: dbUrl });
  await old.q(`CREATE TABLE sites (id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', theme JSONB NOT NULL DEFAULT '{}', livechat_key TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT false, custom_domain TEXT, owner_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const legacyId = (await old.q(`INSERT INTO sites (slug, name, owner_email) VALUES ('legacy','Legacy','Erin@example.com') RETURNING id`)).rows[0].id;
  await old.close();

  // Groups: "crew" is a team carol owns and dan is in.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-groups-'));
  const groupsFile = path.join(tmp, 'groups.json');
  const downFlag = path.join(tmp, 'down');
  const setGroups = g => fs.writeFileSync(groupsFile, JSON.stringify(g));
  setGroups({ crew: { name: 'Harbour crew', kind: 'team', owners: [carol], members: [dan] } });

  // Drive's /api/svc/managed-libraries.
  const libs = new Map();
  let nextLib = 1;
  const drive = await fakeServer((req, body) => {
    if (req.headers.authorization !== 'Bearer drive-token') return { status: 401, body: { error: 'bad token' } };
    const m = /^\/api\/svc\/managed-libraries(?:\/([^/?]+))?(\/items)?/.exec(req.url);
    const lib = m[1] && libs.get(m[1]);
    if (req.method === 'POST' && !m[1]) {
      const id = `00000000-0000-0000-0000-${String(nextLib++).padStart(12, '0')}`;
      libs.set(id, { ...body, files: 0 });
      return { body: { id } };
    }
    if (!lib) return { status: 404, body: { error: 'Not found' } };
    if (req.method === 'PUT') { Object.assign(lib, body); return { body: { ok: true } }; }
    if (req.method === 'DELETE') {
      if (lib.files) return { status: 409, body: { error: 'Move or delete everything in the library first' } };
      libs.delete(m[1]);
      return { body: { ok: true } };
    }
    return { body: { crumbs: [{ id: null, name: lib.name }], items: lib.files ? [{ id: 'f1', name: 'Plan.docx', kind: 'file', size: 2048, modifiedAt: new Date().toISOString(), modifiedBy: alice }] : [] } };
  });
  // The Admin center's policy feed: held@ is on hold.
  const policy = await fakeServer(() => ({ body: { holds: [{ id: 'h1', name: 'Case', custodians: [held], apps: [] }], retention: [], updatedAt: '' } }));

  const env = {
    ...process.env, DATABASE_URL: dbUrl, PORT: String(PORT), PROXY_SHARED_SECRET: SECRET, NODE_ENV: 'test',
    FAKE_GROUPS_FILE: groupsFile, FAKE_GROUPS_DOWN: downFlag,
    SITES_DRIVE_URL: drive.url, DRIVE_SVC_TOKEN: 'drive-token', SITES_DRIVE_PUBLIC_URL: 'https://drive.example.com',
    SITES_SYNC_MINUTES: '0.01', ADMIN_INTERNAL_URL: policy.url, COMPLIANCE_TOKEN: 'comp-token',
  };
  delete env.DEV_USER_EMAIL;
  delete env.DEV_EMAIL;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'fake-groups.js'), path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: 'inherit' });
  t.after(async () => {
    if (child.exitCode == null) await new Promise(r => { child.once('exit', r); child.kill(); });
    drive.server.close();
    policy.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await admin.q(`DROP DATABASE IF EXISTS ${name}`);
    await admin.close();
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch {}
    if (!up) await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(up, 'server did not start');

  const api = async (method, p, { as, body, headers: extra = {} } = {}) => {
    const headers = { 'content-type': 'application/json', 'x-proxy-auth-secret': SECRET, ...extra };
    if (as) headers['x-auth-request-email'] = as;
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method, headers, body: body && JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text };
  };
  const ids = list => list.map(s => Number(s.id));
  const sitesOf = async as => (await api('GET', '/api/sites', { as })).body;
  const searchAs = async (as, query) => (await api('POST', '/api/search', { as, body: { query } })).body.results.map(r => r.id);
  const libFor = async (siteId, as = alice) => libs.get((await api('GET', `/api/sites/${siteId}`, { as })).body.site.library_id);
  const people = lib => Object.fromEntries(lib.members.map(m => [m.email, m.role]));
  const waitFor = async (fn, what) => {
    for (let i = 0; i < 40; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
    assert.fail(`timed out waiting for ${what}`);
  };

  // alice's private team site, with a page about lanterns.
  const team = (await api('POST', '/api/sites', { as: alice, body: { name: 'Lantern project', private: true } })).body;
  const page = (await api('POST', `/api/sites/${team.id}/pages`, { as: alice, body: { title: 'Plan' } })).body;
  await api('PATCH', `/api/pages/${page.id}`, { as: alice, body: { blocks: [{ type: 'text', data: { text: 'Paper lanterns for the quay' } }] } });

  await t.test('sites from before permissions belong to their creator', async () => {
    const legacy = (await sitesOf(erin)).find(s => Number(s.id) === Number(legacyId));
    assert.equal(legacy.role, 'owner');
    assert.equal(legacy.private, false);
    assert.equal((await sitesOf(bob)).find(s => Number(s.id) === Number(legacyId)).role, 'visitor');
  });

  await t.test('a private site is invisible to everyone else', async () => {
    assert.equal(team.private, true);
    assert.equal(team.role, 'owner');
    assert.ok(ids(await sitesOf(alice)).includes(Number(team.id)));
    assert.ok(!ids(await sitesOf(bob)).includes(Number(team.id)));
    assert.equal((await api('GET', `/api/sites/${team.id}`, { as: bob })).status, 404);
    assert.equal((await api('GET', `/api/pages/${page.id}/preview`, { as: bob })).status, 404);
    assert.equal((await api('PATCH', `/api/pages/${page.id}`, { as: bob, body: { title: 'x' } })).status, 404);
    assert.equal((await api('GET', `/api/sites/${team.id}/library`, { as: bob })).status, 404);
    assert.deepEqual(await searchAs(bob, 'lanterns'), []);
    assert.deepEqual(await searchAs(alice, 'lanterns'), [`page:${page.id}`]);
  });

  await t.test('visitors read, members edit, owners manage', async () => {
    assert.equal((await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: 'Bob@Example.com', role: 'visitor' } })).status, 200);
    assert.equal((await api('GET', `/api/sites/${team.id}`, { as: bob })).body.role, 'visitor');
    assert.equal((await api('GET', `/api/pages/${page.id}/preview`, { as: bob })).status, 200);
    assert.deepEqual(await searchAs(bob, 'lanterns'), [`page:${page.id}`]);
    assert.equal((await api('PATCH', `/api/pages/${page.id}`, { as: bob, body: { title: 'x' } })).status, 403);
    assert.equal((await api('POST', `/api/sites/${team.id}/pages`, { as: bob, body: { title: 'x' } })).status, 403);

    await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: bob, role: 'member' } });
    assert.equal((await api('PATCH', `/api/pages/${page.id}`, { as: bob, body: { title: 'Plan v2' } })).body.updated_by, bob);
    assert.equal((await api('PATCH', `/api/sites/${team.id}`, { as: bob, body: { name: 'Mine' } })).status, 403);
    assert.equal((await api('PUT', `/api/sites/${team.id}/members`, { as: bob, body: { principal: erin, role: 'owner' } })).status, 403);
    assert.equal((await api('DELETE', `/api/sites/${team.id}`, { as: bob })).status, 403);

    const list = (await api('GET', `/api/sites/${team.id}/members`, { as: bob })).body;
    assert.equal(list.canManage, false);
    assert.deepEqual(list.members.map(m => [m.principal, m.role]), [[alice, 'owner'], [bob, 'member']]);
    assert.equal((await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: 'not an email', role: 'member' } })).status, 400);
  });

  await t.test('a site always keeps an owner', async () => {
    assert.equal((await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: alice, role: 'member' } })).status, 400);
    assert.equal((await api('DELETE', `/api/sites/${team.id}/members?principal=${alice}`, { as: alice })).status, 400);
    assert.equal((await api('GET', `/api/sites/${team.id}`, { as: alice })).body.role, 'owner');
  });

  await t.test('the document library follows the site\'s people', async () => {
    const lib = await libFor(team.id);
    assert.equal(lib.managedBy, `sites:${team.id}`);
    assert.deepEqual(people(lib), { [alice]: 'owner', [bob]: 'editor' });
    const docs = (await api('GET', `/api/sites/${team.id}/library`, { as: bob })).body;
    assert.equal(docs.canEdit, true);
    assert.match(docs.url, /^https:\/\/drive\.example\.com\/\?library=/);
    await api('PATCH', `/api/sites/${team.id}`, { as: alice, body: { name: 'Lantern festival' } });
    assert.equal((await libFor(team.id)).name, 'Lantern festival');
  });

  await t.test('a private site can\'t be published, and going private takes it off the web', async () => {
    assert.equal((await api('PATCH', `/api/sites/${team.id}`, { as: alice, body: { published: true } })).status, 400);
    const comm = (await api('POST', '/api/sites', { as: alice, body: { name: 'Harbour News' } })).body;
    assert.equal(comm.private, false);
    await api('PATCH', `/api/sites/${comm.id}`, { as: alice, body: { published: true } });
    assert.equal((await api('GET', `/s/${comm.slug}`)).status, 200);
    assert.ok(ids(await sitesOf(erin)).includes(Number(comm.id)));
    const priv = (await api('PATCH', `/api/sites/${comm.id}`, { as: alice, body: { private: true } })).body;
    assert.equal(priv.published, false);
    assert.equal((await api('GET', `/s/${comm.slug}`)).status, 404);
    assert.ok(!ids(await sitesOf(erin)).includes(Number(comm.id)));
  });

  let crewSite;
  await t.test('a group\'s site: its owners own it, its members are members', async () => {
    assert.equal((await api('POST', '/api/sites', { as: dan, body: { name: 'Crew', groupId: 'crew' } })).status, 403);
    assert.equal((await api('POST', '/api/sites', { as: erin, body: { name: 'Crew', groupId: 'crew' } })).status, 404);
    crewSite = (await api('POST', '/api/sites', { as: carol, body: { name: 'Crew', groupId: 'crew' } })).body;
    assert.equal(crewSite.private, true);
    assert.equal(crewSite.group_id, 'crew');
    assert.equal((await api('POST', '/api/sites', { as: carol, body: { name: 'Crew 2', groupId: 'crew' } })).status, 409);
    assert.equal((await api('GET', `/api/sites/${crewSite.id}`, { as: dan })).body.role, 'member');
    assert.equal((await api('GET', `/api/sites/${crewSite.id}`, { as: erin })).status, 404);
    const groups = (await api('GET', '/api/groups', { as: carol })).body;
    assert.deepEqual(groups.map(g => [g.id, g.role, g.siteId]), [['crew', 'owner', Number(crewSite.id)]]);
    const tab = JSON.parse(fs.readFileSync(`${groupsFile}.resources`, 'utf8'));
    assert.deepEqual(tab.map(r => [r.id, r.app, r.ref]), [['crew', 'sites', String(crewSite.id)]]);
    // carol made it, and the team's owners keep it even without her own grant.
    assert.equal((await api('DELETE', `/api/sites/${crewSite.id}/members?principal=${carol}`, { as: carol })).status, 200);
    assert.equal((await api('GET', `/api/sites/${crewSite.id}`, { as: carol })).body.role, 'owner');
  });

  await t.test('group grants, and libraries that keep up with the group', async () => {
    await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: 'group:crew', role: 'visitor' } });
    assert.equal((await api('GET', `/api/sites/${team.id}`, { as: dan })).body.role, 'visitor');
    assert.deepEqual(await searchAs(dan, 'lanterns'), [`page:${page.id}`]);
    assert.deepEqual(people(await libFor(team.id)), { [alice]: 'owner', [bob]: 'editor', [carol]: 'viewer', [dan]: 'viewer' });
    assert.deepEqual(people(await libFor(crewSite.id, carol)), { [carol]: 'owner', [dan]: 'editor' });

    // erin joins the group in the Groups app: she gets in, and the libraries catch up on their own.
    setGroups({ crew: { name: 'Harbour crew', kind: 'team', owners: [carol], members: [dan, erin] } });
    assert.equal((await api('GET', `/api/sites/${crewSite.id}`, { as: erin })).body.role, 'member');
    await waitFor(async () => (people(await libFor(team.id))[erin] === 'viewer'), 'the library sync');

    // While Groups is away, group grants give nobody access and libraries keep their people.
    fs.writeFileSync(downFlag, '');
    assert.equal((await api('GET', `/api/sites/${team.id}`, { as: dan })).status, 404);
    setGroups({ crew: { name: 'Harbour crew', kind: 'team', owners: [carol], members: [] } });
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(people(await libFor(team.id))[dan], 'viewer');
    fs.rmSync(downFlag);
    await waitFor(async () => !people(await libFor(team.id))[dan], 'dan leaving the library');
  });

  await t.test('a site with documents can\'t be deleted', async () => {
    const lib = await libFor(crewSite.id, carol);
    lib.files = 1;
    const docs = (await api('GET', `/api/sites/${crewSite.id}/library`, { as: carol })).body;
    assert.deepEqual(docs.items.map(i => [i.name, i.url]), [['Plan.docx', 'https://drive.example.com/?preview=f1']]);
    const del = await api('DELETE', `/api/sites/${crewSite.id}`, { as: carol });
    assert.equal(del.status, 409);
    assert.match(del.body.error, /documents/);
    lib.files = 0;
    assert.equal((await api('DELETE', `/api/sites/${crewSite.id}`, { as: carol })).status, 200);
    assert.equal(libs.size, 2);
  });

  await t.test('compliance search and export cover private sites, and holds keep deleted pages', async () => {
    assert.equal((await api('POST', '/api/compliance/search', { body: { query: 'lanterns' } })).status, 401);
    const auth = { authorization: 'Bearer comp-token' };
    const hits = (await api('POST', '/api/compliance/search', { headers: auth, body: { query: 'lanterns' } })).body;
    assert.deepEqual(hits.hits.map(h => [h.id, h.owner]), [[`page:${page.id}`, alice]]);
    assert.deepEqual(hits.hits[0].participants, [bob]);
    assert.equal((await api('POST', '/api/compliance/search', { headers: auth, body: { query: 'lanterns', custodians: [erin] } })).body.total, 0);

    const exp = (await api('POST', '/api/compliance/export', { headers: auth, body: { ids: [`page:${page.id}`] } })).body;
    assert.match(exp.items[0].text, /Paper lanterns/);
    assert.equal(exp.items[0].metadata.site.private, true);

    // A page held@ edited is kept, out of sight, when it's deleted.
    await api('PUT', `/api/sites/${team.id}/members`, { as: alice, body: { principal: held, role: 'member' } });
    const p2 = (await api('POST', `/api/sites/${team.id}/pages`, { as: held, body: { title: 'Evidence' } })).body;
    await api('PATCH', `/api/pages/${p2.id}`, { as: held, body: { blocks: [{ type: 'text', data: { text: 'Kraken sighting log' } }] } });
    assert.equal((await api('DELETE', `/api/pages/${p2.id}`, { as: alice })).status, 200);
    assert.ok(!(await api('GET', `/api/sites/${team.id}`, { as: alice })).body.pages.some(p => p.id === p2.id));
    assert.deepEqual(await searchAs(alice, 'kraken'), []);
    const kept = (await api('POST', '/api/compliance/search', { headers: auth, body: { query: 'kraken' } })).body.hits;
    assert.deepEqual(kept.map(h => [h.id, h.deleted]), [[`page:${p2.id}`, true]]);
    // ...and the site can't be deleted while it holds held@'s pages.
    assert.equal((await api('DELETE', `/api/sites/${team.id}`, { as: alice })).status, 409);
  });
});
