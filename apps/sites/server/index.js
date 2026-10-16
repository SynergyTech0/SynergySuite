const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { renderPage } = require('./render');
const { SearchInputError } = require('@synergy/search');
const { search } = require('./search');

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
`;

const BLOCK_TYPES = ['hero', 'heading', 'text', 'image', 'cta', 'columns', 'form', 'booking', 'embed', 'footer'];

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function cleanBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 60)
    .filter(b => BLOCK_TYPES.includes(b.type))
    .map(b => ({ type: b.type, data: (b.data && typeof b.data === 'object') ? b.data : {} }));
}

const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

// Suite search for the signed-in person (the Search app calls this with their gateway headers).
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await search(q, req.body));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.get('/sites', wrap(async (req, res) => {
  res.json((await q(
    `SELECT s.*, (SELECT count(*) FROM pages p WHERE p.site_id = s.id)::int AS page_count
     FROM sites s ORDER BY lower(s.name)`)).rows);
}));

router.post('/sites', wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!slugify(name)) return res.status(400).json({ error: 'name required' });
  let slug = slugify(name);
  // ensure unique slug
  if ((await q('SELECT 1 FROM sites WHERE slug = $1', [slug])).rows.length) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const site = (await q(
    `INSERT INTO sites (slug, name, owner_email) VALUES ($1,$2,$3) RETURNING *`,
    [slug, String(name).slice(0, 100), req.userEmail])).rows[0];
  // seed a home page
  await q(
    `INSERT INTO pages (site_id, slug, title, is_home, blocks) VALUES ($1,'home',$2,true,$3)`,
    [site.id, String(name).slice(0, 100),
     JSON.stringify([
       { type: 'hero', data: { heading: name, subheading: 'Welcome to our site.', buttonText: 'Get started', buttonUrl: '#' } },
       { type: 'footer', data: { text: `© ${name}` } },
     ])]);
  res.json(site);
}));

router.get('/sites/:id', wrap(async (req, res) => {
  const site = (await q('SELECT * FROM sites WHERE id = $1', [Number(req.params.id)])).rows[0];
  if (!site) return res.status(404).json({ error: 'not found' });
  const pages = (await q('SELECT * FROM pages WHERE site_id = $1 ORDER BY is_home DESC, sort, id', [site.id])).rows;
  res.json({ site, pages });
}));

router.patch('/sites/:id', wrap(async (req, res) => {
  const { name, description, theme, published, livechatKey } = req.body || {};
  const { rows } = await q(
    `UPDATE sites SET name = COALESCE($2,name), description = COALESCE($3,description),
       theme = COALESCE($4,theme), published = COALESCE($5,published),
       livechat_key = COALESCE($6,livechat_key), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id),
     name != null ? String(name).slice(0, 100) : null,
     description != null ? String(description).slice(0, 300) : null,
     theme != null ? JSON.stringify(theme) : null,
     published != null ? Boolean(published) : null,
     livechatKey != null ? String(livechatKey).slice(0, 60) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

router.delete('/sites/:id', wrap(async (req, res) => {
  await q('DELETE FROM sites WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---- pages ----
router.post('/sites/:id/pages', wrap(async (req, res) => {
  const siteId = Number(req.params.id);
  const { title } = req.body || {};
  let slug = slugify(title) || 'page';
  if ((await q('SELECT 1 FROM pages WHERE site_id = $1 AND slug = $2', [siteId, slug])).rows.length) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const { rows } = await q(
    `INSERT INTO pages (site_id, slug, title, blocks) VALUES ($1,$2,$3,'[]') RETURNING *`,
    [siteId, slug, String(title || 'Untitled').slice(0, 100)]);
  res.json(rows[0]);
}));

router.patch('/pages/:id', wrap(async (req, res) => {
  const { title, blocks, slug } = req.body || {};
  const { rows } = await q(
    `UPDATE pages SET title = COALESCE($2,title), blocks = COALESCE($3,blocks),
       slug = COALESCE($4,slug), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id),
     title != null ? String(title).slice(0, 100) : null,
     blocks != null ? JSON.stringify(cleanBlocks(blocks)) : null,
     slug != null ? slugify(slug) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

router.delete('/pages/:id', wrap(async (req, res) => {
  const p = (await q('SELECT * FROM pages WHERE id = $1', [Number(req.params.id)])).rows[0];
  if (p && p.is_home) return res.status(400).json({ error: 'cannot delete the home page' });
  await q('DELETE FROM pages WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// authed preview (renders current saved state even when unpublished)
router.get('/pages/:id/preview', wrap(async (req, res) => {
  const page = (await q('SELECT * FROM pages WHERE id = $1', [Number(req.params.id)])).rows[0];
  if (!page) return res.status(404).send('not found');
  const site = (await q('SELECT * FROM sites WHERE id = $1', [page.site_id])).rows[0];
  res.type('html').send(renderPage(site, page, { preview: true }));
}));

async function serveSite(req, res, siteSlug, pageSlug) {
  const site = (await q('SELECT * FROM sites WHERE slug = $1 AND published', [siteSlug])).rows[0];
  if (!site) return res.status(404).send('Site not found');
  let page;
  if (pageSlug) page = (await q('SELECT * FROM pages WHERE site_id = $1 AND slug = $2', [site.id, pageSlug])).rows[0];
  else page = (await q('SELECT * FROM pages WHERE site_id = $1 ORDER BY is_home DESC, sort, id LIMIT 1', [site.id])).rows[0];
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

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('sites'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'sites' });

  app.listen(PORT, () => console.log(`SynergySites listening on :${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
