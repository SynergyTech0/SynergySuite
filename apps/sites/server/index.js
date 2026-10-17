const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { renderPage } = require('./render');
const { SearchInputError } = require('@synergy/search');
const { search } = require('./search');
const { atLeast, whoIs, siteAccess, pageAccess, visibleSql, roleOn } = require('./access');
const { groupsOf, linkToGroup } = require('./groups');
const library = require('./library');
const { createCompliance, deletePage, siteHeld } = require('./compliance');

const PORT = portFor('sites');

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5480/sites' });
const q = db.q;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
    id           BIGSERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    theme        JSONB NOT NULL DEFAULT '{"primary":"#4f46e5","font":"sans"}',
    livechat_key TEXT NOT NULL DEFAULT '',
    published    BOOLEAN NOT NULL DEFAULT false,
    custom_domain TEXT,                         -- Phase 2 (MSP hosting)
    owner_email  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pages (
    id         BIGSERIAL PRIMARY KEY,
    site_id    BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    slug       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    is_home    BOOLEAN NOT NULL DEFAULT false,
    sort       INT NOT NULL DEFAULT 0,
    blocks     JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, slug)
);
-- Team sites: private ones are seen only by their people; a team site can belong to a group.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS library_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sites_group_uniq ON sites (group_id) WHERE group_id IS NOT NULL;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
-- Site permissions: a lower-case email or "group:<id>", as owner, member or visitor.
CREATE TABLE IF NOT EXISTS site_members (
    site_id   BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    principal TEXT NOT NULL,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'member', 'visitor')),
    added_by  TEXT NOT NULL DEFAULT '',
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, principal)
);
CREATE INDEX IF NOT EXISTS site_members_principal_idx ON site_members (principal);
-- Sites made before permissions existed are owned by whoever created them.
INSERT INTO site_members (site_id, principal, role, added_by)
  SELECT s.id, lower(s.owner_email), 'owner', s.owner_email FROM sites s
   WHERE NOT EXISTS (SELECT 1 FROM site_members m WHERE m.site_id = s.id)
ON CONFLICT DO NOTHING;
`;

const BLOCK_TYPES = ['hero', 'heading', 'text', 'image', 'cta', 'columns', 'form', 'booking', 'embed', 'footer'];
const ROLES = ['owner', 'member', 'visitor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// How often sites whose people come from groups have their document library re-synced.
const SYNC_MS = Math.max(0.01, Number(process.env.SITES_SYNC_MINUTES) || 5) * 60000;

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function cleanBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 60)
    .filter(b => BLOCK_TYPES.includes(b.type))
    .map(b => ({ type: b.type, data: (b.data && typeof b.data === 'object') ? b.data : {} }));
}

/** "a@x.com" or "group:<id>", or null. */
function cleanPrincipal(raw) {
  const s = String(raw || '').trim();
  const g = /^group:([A-Za-z0-9_-]{1,80})$/.exec(s);
  if (g) return `group:${g[1]}`;
  const e = s.toLowerCase();
  return EMAIL.test(e) && e.length <= 200 ? e : null;
}

/** Where a site opens in this app, for team tabs and links. */
function siteAppUrl(site) {
  const base = process.env.SUITE_DOMAIN ? `https://sites.${process.env.SUITE_DOMAIN}` : '';
  return `${base}/?site=${site.id}`;
}

async function uniqueSlug(name) {
  let slug = slugify(name) || 'site';
  if ((await q('SELECT 1 FROM sites WHERE slug = $1', [slug])).rows.length) slug += '-' + Math.floor(Math.random() * 9000 + 1000);
  return slug;
}

/** A site and its people can no longer be left without an owner. */
async function ownerRemains(site) {
  if (site.group_id) return true; // the team's owners own it
  const { rows } = await q(`SELECT 1 FROM site_members WHERE site_id = $1 AND role = 'owner' LIMIT 1`, [site.id]);
  return rows.length > 0;
}

const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

// The groups I'm in, so I can make a site for a team I own.
router.get('/groups', wrap(async (req, res) => {
  const groups = await groupsOf(req.userEmail);
  const taken = new Map((await q('SELECT group_id, id FROM sites WHERE group_id = ANY($1::text[])',
    [groups.map(g => g.id)])).rows.map(r => [r.group_id, Number(r.id)]));
  res.json(groups.map(g => ({
    id: g.id, name: g.name, kind: g.kind || '', email: g.email || '', role: g.role || 'member',
    siteId: taken.get(g.id) || null,
  })));
}));

// Suite search for the signed-in person (the Search app calls this with their gateway headers).
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await search(q, req.body, await whoIs(req.userEmail)));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.get('/sites', wrap(async (req, res) => {
  const who = await whoIs(req.userEmail);
  const v = visibleSql(who);
  const { rows } = await q(
    `SELECT s.*, (SELECT count(*) FROM pages p WHERE p.site_id = s.id AND p.held_deleted_at IS NULL)::int AS page_count
       FROM sites s WHERE ${v.sql} ORDER BY lower(s.name)`, v.params);
  const out = [];
  for (const s of rows) out.push({ ...s, role: await roleOn(q, who, s) });
  res.json(out);
}));

// New site. { name, private?, groupId? }: with a group it's that team's site (private unless said
// otherwise), and only the group's owners can make it.
router.post('/sites', wrap(async (req, res) => {
  const { name, groupId } = req.body || {};
  if (!slugify(name)) return res.status(400).json({ error: 'name required' });
  let group = null;
  if (groupId != null && groupId !== '') {
    group = (await groupsOf(req.userEmail)).find(g => g.id === String(groupId));
    if (!group) return res.status(404).json({ error: 'group not found' });
    if (group.role !== 'owner') return res.status(403).json({ error: 'Only the group\'s owners can make its site' });
    const existing = (await q('SELECT id FROM sites WHERE group_id = $1', [group.id])).rows[0];
    if (existing) return res.status(409).json({ error: 'That group already has a site', siteId: Number(existing.id) });
  }
  const priv = req.body.private != null ? Boolean(req.body.private) : !!group;
  let site = (await q(
    `INSERT INTO sites (slug, name, owner_email, private, group_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [await uniqueSlug(name), String(name).slice(0, 100), req.userEmail, priv, group ? group.id : null])).rows[0];
  await q(`INSERT INTO site_members (site_id, principal, role, added_by) VALUES ($1,$2,'owner',$3)`,
    [site.id, req.userEmail.toLowerCase(), req.userEmail]);
  // seed a home page
  await q(
    `INSERT INTO pages (site_id, slug, title, is_home, blocks, created_by, updated_by) VALUES ($1,'home',$2,true,$3,$4,$4)`,
    [site.id, String(name).slice(0, 100),
     JSON.stringify(priv ? [
       { type: 'hero', data: { heading: name, subheading: 'Our team site: news, links and documents in one place.' } },
     ] : [
       { type: 'hero', data: { heading: name, subheading: 'Welcome to our site.', buttonText: 'Get started', buttonUrl: '#' } },
       { type: 'footer', data: { text: `© ${name}` } },
     ]), req.userEmail]);
  try {
    site = await library.createLibrary(q, site);
  } catch (e) {
    console.error(`[sites] could not make a document library for site ${site.id}:`, e.message);
  }
  if (group) await linkToGroup(group.id, site, siteAppUrl(site));
  res.json({ ...site, role: 'owner' });
}));

router.get('/sites/:id', wrap(async (req, res) => {
  const { site, role } = await siteAccess(q, req.userEmail, req.params.id);
  const pages = (await q(
    'SELECT * FROM pages WHERE site_id = $1 AND held_deleted_at IS NULL ORDER BY is_home DESC, sort, id', [site.id])).rows;
  res.json({
    site, pages, role,
    library: { linked: library.linked(), id: site.library_id, url: site.library_id ? library.libraryWebUrl(site.library_id) : '' },
  });
}));

router.patch('/sites/:id', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'owner');
  const { name, description, theme, published, livechatKey } = req.body || {};
  const priv = req.body.private != null ? Boolean(req.body.private) : site.private;
  if (published && priv) {
    return res.status(400).json({ error: 'A private site can\'t be published to the web. Make it public first.' });
  }
  const { rows } = await q(
    `UPDATE sites SET name = COALESCE($2,name), description = COALESCE($3,description),
       theme = COALESCE($4,theme), published = CASE WHEN $7 THEN false ELSE COALESCE($5,published) END,
       livechat_key = COALESCE($6,livechat_key), private = $7, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [site.id,
     name != null ? String(name).slice(0, 100) : null,
     description != null ? String(description).slice(0, 300) : null,
     theme != null ? JSON.stringify(theme) : null,
     published != null ? Boolean(published) : null,
     livechatKey != null ? String(livechatKey).slice(0, 60) : null,
     priv]);
  if (name != null && rows[0].name !== site.name) await library.syncLibrary(q, rows[0]);
  res.json(rows[0]);
}));

router.delete('/sites/:id', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'owner');
  if (await siteHeld(q, site)) return res.status(409).json({ error: 'This site is under a legal hold and can\'t be deleted' });
  await library.deleteLibrary(site);
  await q('DELETE FROM sites WHERE id = $1', [site.id]);
  res.json({ ok: true });
}));

// ---- permissions ----
router.get('/sites/:id/members', wrap(async (req, res) => {
  const { site, role } = await siteAccess(q, req.userEmail, req.params.id);
  const { rows } = await q(
    `SELECT principal, role, added_by, added_at FROM site_members WHERE site_id = $1
      ORDER BY array_position(ARRAY['owner','member','visitor'], role), principal`, [site.id]);
  // Name the groups the viewer can see; others show as their id.
  const known = new Map((await groupsOf(req.userEmail)).map(g => [`group:${g.id}`, g.name]));
  res.json({
    role,
    canManage: atLeast(role, 'owner'),
    team: site.group_id ? { id: site.group_id, name: known.get(`group:${site.group_id}`) || '' } : null,
    members: rows.map(r => ({
      principal: r.principal,
      kind: r.principal.startsWith('group:') ? 'group' : 'person',
      name: known.get(r.principal) || '',
      role: r.role, addedBy: r.added_by, addedAt: r.added_at,
    })),
  });
}));

// Add someone (or a group), or change their role: { principal, role }.
router.put('/sites/:id/members', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'owner');
  const principal = cleanPrincipal(req.body && req.body.principal);
  const role = req.body && req.body.role;
  if (!principal) return res.status(400).json({ error: 'Give an email address or a group' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role must be owner, member or visitor' });
  await q(
    `INSERT INTO site_members (site_id, principal, role, added_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (site_id, principal) DO UPDATE SET role = EXCLUDED.role`,
    [site.id, principal, role, req.userEmail]);
  if (!(await ownerRemains(site))) {
    await q(`UPDATE site_members SET role = 'owner' WHERE site_id = $1 AND principal = $2`, [site.id, principal]);
    return res.status(400).json({ error: 'A site needs at least one owner' });
  }
  await library.syncLibrary(q, site);
  res.json({ ok: true });
}));

router.delete('/sites/:id/members', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'owner');
  const principal = cleanPrincipal(req.query.principal);
  if (!principal) return res.status(400).json({ error: 'principal required' });
  const gone = (await q('DELETE FROM site_members WHERE site_id = $1 AND principal = $2 RETURNING *', [site.id, principal])).rows[0];
  if (gone && !(await ownerRemains(site))) {
    await q('INSERT INTO site_members (site_id, principal, role, added_by, added_at) VALUES ($1,$2,$3,$4,$5)',
      [site.id, gone.principal, gone.role, gone.added_by, gone.added_at]);
    return res.status(400).json({ error: 'A site needs at least one owner' });
  }
  await library.syncLibrary(q, site);
  res.json({ ok: true });
}));

// ---- document library (a Drive library) ----
router.post('/sites/:id/library', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'owner');
  if (!library.linked()) return res.status(400).json({ error: 'Drive isn\'t linked: set SITES_DRIVE_URL and DRIVE_SVC_TOKEN' });
  const s = await library.createLibrary(q, site);
  res.json({ id: s.library_id, url: library.libraryWebUrl(s.library_id) });
}));

router.get('/sites/:id/library', wrap(async (req, res) => {
  const { site, role } = await siteAccess(q, req.userEmail, req.params.id);
  if (!site.library_id || !library.linked()) return res.json({ linked: library.linked(), id: null, items: [], crumbs: [] });
  const folder = typeof req.query.folder === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.folder) ? req.query.folder : '';
  const listing = await library.listFolder(site, folder);
  const web = library.libraryWebUrl(site.library_id);
  const driveBase = web ? web.replace(/\/\?library=.*$/, '') : '';
  res.json({
    linked: true, id: site.library_id, url: web, canEdit: atLeast(role, 'member'),
    crumbs: listing.crumbs || [],
    items: (listing.items || []).map(i => ({
      ...i,
      url: !driveBase ? '' : i.kind === 'folder' ? `${driveBase}/?parent=${i.id}` : `${driveBase}/?preview=${i.id}`,
    })),
  });
}));

// ---- pages ----
router.post('/sites/:id/pages', wrap(async (req, res) => {
  const { site } = await siteAccess(q, req.userEmail, req.params.id, 'member');
  const { title } = req.body || {};
  let slug = slugify(title) || 'page';
  if ((await q('SELECT 1 FROM pages WHERE site_id = $1 AND slug = $2', [site.id, slug])).rows.length) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const { rows } = await q(
    `INSERT INTO pages (site_id, slug, title, blocks, created_by, updated_by) VALUES ($1,$2,$3,'[]',$4,$4) RETURNING *`,
    [site.id, slug, String(title || 'Untitled').slice(0, 100), req.userEmail]);
  res.json(rows[0]);
}));

router.patch('/pages/:id', wrap(async (req, res) => {
  const { page } = await pageAccess(q, req.userEmail, req.params.id, 'member');
  const { title, blocks, slug } = req.body || {};
  const { rows } = await q(
    `UPDATE pages SET title = COALESCE($2,title), blocks = COALESCE($3,blocks),
       slug = COALESCE($4,slug), updated_by = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [page.id,
     title != null ? String(title).slice(0, 100) : null,
     blocks != null ? JSON.stringify(cleanBlocks(blocks)) : null,
     slug != null ? slugify(slug) : null,
     req.userEmail]);
  res.json(rows[0]);
}));

router.delete('/pages/:id', wrap(async (req, res) => {
  const { page, site } = await pageAccess(q, req.userEmail, req.params.id, 'member');
  if (page.is_home) return res.status(400).json({ error: 'cannot delete the home page' });
  await deletePage(q, page, site);
  res.json({ ok: true });
}));

// The page as its readers see it (renders current saved state even when unpublished or private).
router.get('/pages/:id/preview', wrap(async (req, res) => {
  const { page, site } = await pageAccess(q, req.userEmail, req.params.id);
  res.type('html').send(renderPage(site, page, { preview: true }));
}));

async function serveSite(req, res, siteSlug, pageSlug) {
  const site = (await q('SELECT * FROM sites WHERE slug = $1 AND published AND NOT private', [siteSlug])).rows[0];
  if (!site) return res.status(404).send('Site not found');
  let page;
  if (pageSlug) page = (await q('SELECT * FROM pages WHERE site_id = $1 AND slug = $2 AND held_deleted_at IS NULL', [site.id, pageSlug])).rows[0];
  else page = (await q('SELECT * FROM pages WHERE site_id = $1 AND held_deleted_at IS NULL ORDER BY is_home DESC, sort, id LIMIT 1', [site.id])).rows[0];
  if (!page) return res.status(404).send('Page not found');
  res.type('html').send(renderPage(site, page));
}

async function main() {
  await db.migrate(SCHEMA, 'sites');
  const app = express();
  baseApp(app, express, '2mb');

  // ---- public published sites (oauth2 skip-auth ^/s/) ----
  app.get('/s/:siteSlug', wrap((req, res) => serveSite(req, res, req.params.siteSlug, null)));
  app.get('/s/:siteSlug/:pageSlug', wrap((req, res) => serveSite(req, res, req.params.siteSlug, req.params.pageSlug)));

  // ---- compliance (Admin center, COMPLIANCE_TOKEN) ----
  app.use('/api/compliance', createCompliance({ q }).router);

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('sites'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'sites' });

  setInterval(() => library.syncGroupLibraries(q).catch(e => console.error('[sites] library sync:', e.message)), SYNC_MS).unref();

  app.listen(PORT, () => console.log(`SynergySites listening on :${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
