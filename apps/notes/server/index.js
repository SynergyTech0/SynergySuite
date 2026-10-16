const express = require('express');
const path = require('path');
const { createDb } = require('@synergy/db');
const { baseApp, requireUser, requireBearer, wrap, errorHandler, serveSpa } = require('@synergy/server');
const { portFor } = require('@synergy/config');
const { createCompliance, holdsEveryVersion } = require('./compliance');
const { createSearch } = require('./search');
const { SearchInputError } = require('@synergy/search');

const PORT = portFor('notes');

const db = createDb({ devUrl: 'postgres://dev:dev@127.0.0.1:5475/notes' });
const q = db.q;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
    id         BIGSERIAL PRIMARY KEY,
    parent_id  BIGINT REFERENCES pages(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    sort       INT NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
-- Who trashed it, and which delete operation it belonged to. The trash view
-- used to show updated_by, i.e. the last editor, not the person who deleted it.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS deleted_batch UUID;
-- Anything already in the trash predates batches; give each row its own so
-- the invariant 'every trashed row has a batch' holds from here on.
UPDATE pages SET deleted_batch = gen_random_uuid()
 WHERE deleted_at IS NOT NULL AND deleted_batch IS NULL;
CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent_id, sort);
CREATE INDEX IF NOT EXISTS pages_batch_idx ON pages (deleted_batch);

-- Spaces: Confluence's top-level container. Every page belongs to one.
CREATE TABLE IF NOT EXISTS spaces (
    id         BIGSERIAL PRIMARY KEY,
    key        TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing pages predate spaces; main() seeds a GENERAL space and backfills
-- every orphan page into it, so space_id is effectively NOT NULL after boot.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS space_id BIGINT REFERENCES spaces(id);
CREATE INDEX IF NOT EXISTS pages_space_idx ON pages (space_id, parent_id, sort);

-- Space access control. Spaces default to OPEN (restricted=false) so the migration
-- preserves the everyone-app: enforcement only bites once a space is restricted.
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS space_members (
    space_id   BIGINT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',   -- viewer | editor | admin
    added_by   TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, email)
);
-- Per-page restrictions: an allowlist tighter than the space. A page with any
-- rows is visible only to listed users (space admins always bypass).
CREATE TABLE IF NOT EXISTS page_restrictions (
    page_id    BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    added_by   TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (page_id, email)
);

-- Version history: one row per saved state, coalesced per author-session so the
-- 800ms autosave does not mint a version per keystroke (see recordVersion).
CREATE TABLE IF NOT EXISTS page_versions (
    id         BIGSERIAL PRIMARY KEY,
    page_id    BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    edited_by  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (page_id, version_no)
);
CREATE INDEX IF NOT EXISTS page_versions_page_idx ON page_versions (page_id, version_no DESC);

-- Labels: shared vocabulary across spaces; a page carries any number of them.
CREATE TABLE IF NOT EXISTS labels (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS page_labels (
    page_id  BIGINT NOT NULL REFERENCES pages(id)  ON DELETE CASCADE,
    label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, label_id)
);
CREATE INDEX IF NOT EXISTS page_labels_label_idx ON page_labels (label_id);

-- Comments: one level of threading (root + replies). Resolve applies to a root.
CREATE TABLE IF NOT EXISTS comments (
    id          BIGSERIAL PRIMARY KEY,
    page_id     BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_id   BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    author      TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL,
    resolved    BOOLEAN NOT NULL DEFAULT false,
    resolved_by TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_page_idx ON comments (page_id, created_at);

-- Full-text search: a weighted title+body vector, maintained automatically by
-- Postgres, indexed with GIN. Title matches outrank body matches (weights A/B).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,  '')), 'B')
  ) STORED;
CREATE INDEX IF NOT EXISTS pages_search_idx ON pages USING GIN (search_vector);

-- Attachments: stored inline as bytea so they ride along in the DB backup.
-- Capped at 12MB per file at the route; a small team wiki, not a media store.
CREATE TABLE IF NOT EXISTS attachments (
    id          BIGSERIAL PRIMARY KEY,
    page_id     BIGINT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size        INT NOT NULL,
    data        BYTEA NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_page_idx ON attachments (page_id, created_at);

-- Templates: a shared library of reusable page skeletons (Confluence blueprints).
CREATE TABLE IF NOT EXISTS templates (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In-app notifications: @mentions in comments, and replies to your comment.
CREATE TABLE IF NOT EXISTS notifications (
    id         BIGSERIAL PRIMARY KEY,
    recipient  TEXT NOT NULL,
    actor      TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL,               -- mention | reply
    page_id    BIGINT REFERENCES pages(id) ON DELETE CASCADE,
    comment_id BIGINT REFERENCES comments(id) ON DELETE CASCADE,
    snippet    TEXT NOT NULL DEFAULT '',
    read       BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient, read, created_at DESC);

-- Live co-editing: the whole Yjs document for a page, persisted as a blob by the
-- collab server (server/collab.mjs). pages.body stays the source of truth for
-- REST/search/render; this is just the CRDT state so a page reopens in place.
CREATE TABLE IF NOT EXISTS page_ydoc (
    page_id    BIGINT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    ydoc       BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legal hold: comments and attachments deleted while their owner is on hold stay,
-- hidden from the app, for compliance search and export.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS held_deleted_at TIMESTAMPTZ;
`;


const router = express.Router();
router.get('/me', wrap(async (req, res) => res.json({ email: req.userEmail })));

// Derive a URL/display key from a name: A–Z0–9 only, uppercased, <=20 chars.
const deriveKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || 'SPACE';

async function generalSpaceId() {
  return (await q(`SELECT id FROM spaces WHERE key = 'GENERAL'`)).rows[0].id;
}

// --- Space authorization -------------------------------------------------
// Bootstrap admins from the environment so a restricted space can never lock
// everyone out (and GENERAL, whose creator is 'system', stays administrable).
const SPACE_ADMINS = (process.env.SPACE_ADMINS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const isGlobalAdmin = email => SPACE_ADMINS.includes(String(email).toLowerCase());
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

// Highest effective role for a user on a space: 'admin' | 'editor' | 'viewer' | null.
// An OPEN space grants everyone 'editor' (the everyone-app); a RESTRICTED space
// grants only its members, creator, and global admins.
async function spaceRole(email, spaceId) {
  email = String(email).toLowerCase();
  if (isGlobalAdmin(email)) return 'admin';
  const sp = (await q('SELECT created_by, restricted FROM spaces WHERE id = $1', [spaceId])).rows[0];
  if (!sp) return null;
  if (sp.created_by && sp.created_by.toLowerCase() === email) return 'admin';
  const m = (await q('SELECT role FROM space_members WHERE space_id = $1 AND email = $2', [spaceId, email])).rows[0];
  if (m) return m.role;
  return sp.restricted ? null : 'editor';
}
async function can(email, spaceId, need) {
  const r = await spaceRole(email, spaceId);
  if (!r) return false;
  return ROLE_RANK[r] >= (need === 'view' ? 1 : need === 'edit' ? 2 : 3);
}
// Space ids the user may view; null means "all spaces" (global admin).
async function viewableSpaceIds(email) {
  email = String(email).toLowerCase();
  if (isGlobalAdmin(email)) return null;
  return (await q(
    `SELECT id FROM spaces
      WHERE restricted = false OR lower(created_by) = $1
         OR id IN (SELECT space_id FROM space_members WHERE email = $1)`, [email])).rows.map(r => r.id);
}
async function spaceIdOfPage(pageId) {
  const r = (await q('SELECT space_id FROM pages WHERE id = $1', [pageId])).rows[0];
  return r ? r.space_id : null;
}
async function pageRestrictedTo(pageId) {
  return (await q('SELECT email FROM page_restrictions WHERE page_id = $1 ORDER BY email', [pageId])).rows.map(r => r.email);
}
// Space ids where the user is an admin (creator or admin member); null = global admin (all).
async function adminSpaceIds(email) {
  email = String(email).toLowerCase();
  if (isGlobalAdmin(email)) return null;
  return (await q(
    `SELECT id FROM spaces WHERE lower(created_by) = $1
      UNION SELECT space_id FROM space_members WHERE email = $1 AND role = 'admin'`, [email])).rows.map(r => r.id);
}
// A page-level allowlist blocks non-listed users, but a space admin always bypasses.
async function pageRestrictionBlocks(email, pageId, spaceRoleValue) {
  if (spaceRoleValue === 'admin') return false;
  const allow = await pageRestrictedTo(pageId);
  return allow.length > 0 && !allow.includes(String(email).toLowerCase());
}
// Guard a page-scoped request. Returns the page's space_id, or null after
// having already sent a 404 (no such page) or 403 (no access) response.
async function guardPage(req, res, pageId, need) {
  const sid = await spaceIdOfPage(pageId);
  if (sid == null) { res.status(404).json({ error: 'not found' }); return null; }
  const role = await spaceRole(req.userEmail, sid);
  const rank = need === 'view' ? 1 : need === 'edit' ? 2 : 3;
  if (!role || ROLE_RANK[role] < rank) { res.status(403).json({ error: 'forbidden' }); return null; }
  if (await pageRestrictionBlocks(req.userEmail, pageId, role)) { res.status(403).json({ error: 'forbidden' }); return null; }
  return sid;
}
// Record an in-app notification. Never notifies the actor themselves, and never
// someone who cannot view the page — so a mention can't leak restricted content.
async function createNotification(recipient, actor, kind, pageId, commentId, snippet, spaceId) {
  recipient = String(recipient).toLowerCase();
  if (!recipient.includes('@') || recipient === String(actor).toLowerCase()) return;
  const role = await spaceRole(recipient, spaceId);
  if (!role) return;                                             // can't see the space
  if (await pageRestrictionBlocks(recipient, pageId, role)) return; // can't see this page
  await q(`INSERT INTO notifications (recipient, actor, kind, page_id, comment_id, snippet)
           VALUES ($1,$2,$3,$4,$5,$6)`, [recipient, actor, kind, pageId, commentId, String(snippet).slice(0, 140)]);
}

const VERSION_COALESCE_MS = 10 * 60 * 1000; // one author's edits within 10 min = one version

// Append a version snapshot of a page's saved state. Consecutive saves by the
// same author inside the coalesce window fold into the latest version instead of
// adding a row, so the 800ms autosave does not mint a version per keystroke.
// No-op when nothing changed. `force` always writes a fresh row (used by restore, and while a
// legal hold covers the page owner or the editor, so no saved text is overwritten).
async function recordVersion(pageId, title, body, editor, { force = false } = {}) {
  const latest = (await q(
    `SELECT id, version_no, title, body, edited_by, created_at
       FROM page_versions WHERE page_id = $1 ORDER BY version_no DESC LIMIT 1`, [pageId])).rows[0];
  if (latest && latest.title === title && latest.body === body) return latest.version_no;
  if (!force && latest && await holdsEveryVersion(q, pageId, editor)) force = true;
  if (!force && latest && latest.edited_by === editor &&
      (Date.now() - new Date(latest.created_at).getTime()) < VERSION_COALESCE_MS) {
    await q('UPDATE page_versions SET title = $2, body = $3, created_at = now() WHERE id = $1',
      [latest.id, title, body]);
    return latest.version_no;
  }
  const next = (latest?.version_no || 0) + 1;
  await q(`INSERT INTO page_versions (page_id, version_no, title, body, edited_by)
           VALUES ($1,$2,$3,$4,$5)`, [pageId, next, title, body, editor]);
  return next;
}

router.get('/spaces', wrap(async (req, res) => {
  const vis = await viewableSpaceIds(req.userEmail); // null = all (global admin)
  const rows = (await q(
    `SELECT s.id, s.key, s.name, s.restricted, s.created_by, s.created_at,
            (SELECT count(*) FROM pages p
              WHERE p.space_id = s.id AND p.deleted_at IS NULL)::int AS pages
       FROM spaces s ${vis ? 'WHERE s.id = ANY($1::bigint[])' : ''}
      ORDER BY lower(s.name)`, vis ? [vis] : [])).rows;
  for (const s of rows) s.role = await spaceRole(req.userEmail, s.id);
  res.json(rows);
}));

router.post('/spaces', wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const base = deriveKey((req.body || {}).key || name);
  // Keys are unique; if taken, suffix a counter rather than 409ing the user.
  let key = base;
  for (let n = 2; n <= 99; n++) {
    const taken = (await q('SELECT 1 FROM spaces WHERE key = $1', [key])).rows.length;
    if (!taken) break;
    key = base.slice(0, 18) + n;
  }
  const { rows } = await q(
    `INSERT INTO spaces (key, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [key, name.slice(0, 120), req.userEmail]);
  res.json({ ...rows[0], pages: 0, role: 'admin' });
}));

// Space administration — restrict/rename and membership. Admin-only.
router.patch('/spaces/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await can(req.userEmail, id, 'admin'))) return res.status(403).json({ error: 'forbidden' });
  const { name, restricted } = req.body || {};
  const { rows } = await q(
    `UPDATE spaces SET name = COALESCE($2, name), restricted = COALESCE($3, restricted)
      WHERE id = $1 RETURNING *`,
    [id, name != null ? String(name).slice(0, 120) : null,
     restricted != null ? Boolean(restricted) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

const spaceMembers = id => q(
  'SELECT email, role, added_by, created_at FROM space_members WHERE space_id = $1 ORDER BY email', [id])
  .then(r => r.rows);

router.get('/spaces/:id/members', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await can(req.userEmail, id, 'admin'))) return res.status(403).json({ error: 'forbidden' });
  res.json(await spaceMembers(id));
}));

router.post('/spaces/:id/members', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await can(req.userEmail, id, 'admin'))) return res.status(403).json({ error: 'forbidden' });
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const role = String((req.body || {}).role || 'viewer');
  if (!email.includes('@')) return res.status(400).json({ error: 'valid email required' });
  if (!ROLE_RANK[role]) return res.status(400).json({ error: 'role must be viewer, editor or admin' });
  await q(
    `INSERT INTO space_members (space_id, email, role, added_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (space_id, email) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, role, req.userEmail]);
  res.json(await spaceMembers(id));
}));

router.delete('/spaces/:id/members/:email', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await can(req.userEmail, id, 'admin'))) return res.status(403).json({ error: 'forbidden' });
  await q('DELETE FROM space_members WHERE space_id = $1 AND email = $2',
    [id, String(req.params.email).toLowerCase()]);
  res.json(await spaceMembers(id));
}));

// Label name → a single lowercase, hyphenated token (Confluence-style).
const normLabel = s => String(s || '').toLowerCase().trim()
  .replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
async function pageLabels(id) {
  return (await q(
    `SELECT l.id, l.name FROM page_labels pl JOIN labels l ON l.id = pl.label_id
      WHERE pl.page_id = $1 ORDER BY l.name`, [id])).rows;
}
async function pageAttachments(id) {
  return (await q(
    `SELECT id, filename, mime, size, uploaded_by, created_at
       FROM attachments WHERE page_id = $1 AND held_deleted_at IS NULL ORDER BY created_at`, [id])).rows;
}

// Compact server-side markdown → HTML for Word (.docx) export. A subset of the
// client renderer (headings, bold/italic/code, links, lists, tables, code
// blocks) — enough to produce a well-structured Word document.
function mdToHtml(md) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                    // drop images (no fetch in docx)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  const lines = String(md || '').split('\n');
  let html = '', inList = false, inCode = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) { if (!inCode) { closeList(); html += '<pre>'; inCode = true; } else { html += '</pre>'; inCode = false; } continue; }
    if (inCode) { html += esc(line) + '<br/>'; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      closeList();
      let t = '<table><thead><tr>' + cells(line).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += '<tr>' + cells(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      i--; html += t + '</tbody></table>'; continue;
    }
    const li = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.*)/.exec(line);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    if (h) { const n = h[1].length; html += `<h${n}>${inline(h[2])}</h${n}>`; continue; }
    if (line.trim() === '' || /^:::/.test(line.trim())) continue; // skip blanks + panel fences
    html += `<p>${inline(line)}</p>`;
  }
  closeList(); if (inCode) html += '</pre>';
  return html;
}

router.get('/pages', wrap(async (req, res) => {
  const vis = await viewableSpaceIds(req.userEmail); // null = all
  const params = [];
  const p = v => { params.push(v); return '$' + params.length; };
  const where = ['p.deleted_at IS NULL'];
  if (vis) {
    where.push(`p.space_id = ANY(${p(vis)}::bigint[])`);
    const adm = await adminSpaceIds(req.userEmail); // non-null (vis set ⇒ not global admin)
    where.push(`(NOT EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id)
                 OR EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id AND pr.email = ${p(String(req.userEmail).toLowerCase())})
                 OR p.space_id = ANY(${p(adm)}::bigint[]))`);
  }
  let order = 'p.sort, lower(p.title)';
  if (req.query.label) {           // label view crosses spaces (still access-filtered)
    where.push(`EXISTS (SELECT 1 FROM page_labels pl WHERE pl.page_id = p.id AND pl.label_id = ${p(Number(req.query.label))})`);
    order = 'lower(p.title)';
  } else if (req.query.space) {     // explicit space must be viewable
    if (!(await can(req.userEmail, Number(req.query.space), 'view'))) return res.status(403).json({ error: 'forbidden' });
    where.push(`p.space_id = ${p(Number(req.query.space))}`);
  }
  res.json((await q(
    `SELECT p.id, p.parent_id, p.space_id, p.title, p.sort, p.updated_at, p.updated_by
       FROM pages p WHERE ${where.join(' AND ')} ORDER BY ${order}`, params)).rows);
}));

router.get('/labels', wrap(async (req, res) => {
  res.json((await q(
    `SELECT l.id, l.name,
            (SELECT count(*) FROM page_labels pl JOIN pages p ON p.id = pl.page_id
              WHERE pl.label_id = l.id AND p.deleted_at IS NULL)::int AS pages
       FROM labels l ORDER BY l.name`)).rows);
}));

router.get('/pages/:id', wrap(async (req, res) => {
  const p = (await q('SELECT * FROM pages WHERE id = $1 AND deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!p) return res.status(404).json({ error: 'not found' });
  const role = await spaceRole(req.userEmail, p.space_id);
  if (!role) return res.status(403).json({ error: 'forbidden' });
  if (await pageRestrictionBlocks(req.userEmail, p.id, role)) return res.status(403).json({ error: 'forbidden' });
  p.labels = await pageLabels(p.id);
  p.attachments = await pageAttachments(p.id);
  p.myRole = role;                                  // UI shows read-only for viewers
  p.restrictedTo = await pageRestrictedTo(p.id);    // allowlist for the restrict UI
  res.json(p);
}));

router.post('/pages', wrap(async (req, res) => {
  const { title, parentId = null, body = '', spaceId = null, templateId = null } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'title required' });
  // A template prefills the body when the caller didn't supply one.
  let initialBody = body;
  if (templateId && !body) {
    const t = (await q('SELECT body FROM templates WHERE id = $1', [Number(templateId)])).rows[0];
    if (t) initialBody = t.body;
  }
  // A subpage always lives in its parent's space; a top-level page takes the
  // requested space, falling back to GENERAL so the old space-less button works.
  let sid = spaceId ? Number(spaceId) : null;
  if (parentId) {
    const par = (await q('SELECT space_id FROM pages WHERE id = $1', [Number(parentId)])).rows[0];
    if (par && par.space_id) sid = par.space_id;
  }
  if (!sid) sid = await generalSpaceId();
  if (!(await can(req.userEmail, sid, 'edit'))) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await q(
    `INSERT INTO pages (title, parent_id, space_id, body, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
    [title.trim().slice(0, 200), parentId ? Number(parentId) : null, sid, initialBody, req.userEmail]);
  res.json(rows[0]);
}));

router.patch('/pages/:id', wrap(async (req, res) => {
  const { title, body, parentId, sort } = req.body || {};
  const pid = Number(req.params.id);
  if (await guardPage(req, res, pid, 'edit') == null) return;
  // Reparent cycle guard: a page can't become its own descendant (that would make
  // the tree recursion and the delete-subtree query loop forever).
  if (parentId != null && String(parentId) !== 'root') {
    const np = Number(parentId);
    if (np === pid) return res.status(400).json({ error: 'cannot nest a page under itself' });
    let cur = np, guard = 0;
    while (cur != null && guard++ < 1000) {
      if (cur === pid) return res.status(400).json({ error: 'cannot move a page under its own subpage' });
      const r = (await q('SELECT parent_id FROM pages WHERE id = $1', [cur])).rows[0];
      cur = r && r.parent_id != null ? Number(r.parent_id) : null;
    }
  }
  const { rows } = await q(
    `UPDATE pages SET title = COALESCE($2, title), body = COALESCE($3, body),
       parent_id = CASE WHEN $4::text = 'root' THEN NULL WHEN $4 IS NOT NULL THEN $4::bigint ELSE parent_id END,
       sort = COALESCE($6, sort),
       updated_by = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title != null ? String(title).slice(0, 200) : null, body,
     parentId != null ? String(parentId) : null, req.userEmail,
     sort != null ? Number(sort) : null]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  // Version only when content moved — a pure re-parent sends neither field.
  if (title != null || body != null) {
    await recordVersion(rows[0].id, rows[0].title, rows[0].body, req.userEmail);
  }
  res.json(rows[0]);
}));

// Soft delete, and it must cover descendants: the UI warns that deleting a page
// removes its subpages, and a restore that brought back only the parent would
// leave orphans pointing at a hidden row.
const SUBTREE = `WITH RECURSIVE t AS (
    SELECT id FROM pages WHERE id = $1
    UNION ALL
    SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id
  ) SELECT id FROM t`;

router.delete('/pages/:id', wrap(async (req, res) => {
  if (await guardPage(req, res, Number(req.params.id), 'edit') == null) return;
  // One batch per delete. Restore reverses the batch, not the subtree, so a
  // subpage someone trashed separately last week does not come back with it.
  const { rows } = await q(
    `UPDATE pages SET deleted_at = now(), deleted_by = $2, deleted_batch = gen_random_uuid()
      WHERE id IN (${SUBTREE}) AND deleted_at IS NULL
      RETURNING id, deleted_batch`, [Number(req.params.id), req.userEmail]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  // gen_random_uuid() is volatile, so each row got its own. Collapse them onto
  // the one the requested page received.
  const batch = rows.find(r => String(r.id) === String(req.params.id))?.deleted_batch
    || rows[0].deleted_batch;
  await q('UPDATE pages SET deleted_batch = $1 WHERE id = ANY($2::bigint[])',
    [batch, rows.map(r => r.id)]);
  res.json({ ok: true, trashed: rows.length, batch });
}));

// List one entry per delete, not one per row: trashing a page with eight
// subpages is one thing that happened, and restoring it is one decision.
router.get('/trash', wrap(async (req, res) => {
  const vis = await viewableSpaceIds(req.userEmail); // null = all
  res.json((await q(
    `SELECT p.id, p.parent_id, p.title, p.created_by, p.updated_by,
            p.deleted_by, p.deleted_at, p.deleted_batch,
            (SELECT count(*) - 1 FROM pages c WHERE c.deleted_batch = p.deleted_batch)::int
              AS subpages,
            (p.parent_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM pages par
                WHERE par.id = p.parent_id AND par.deleted_at IS NOT NULL
             )) AS parent_trashed
       FROM pages p
      WHERE p.deleted_at IS NOT NULL
        ${vis ? 'AND p.space_id = ANY($1::bigint[])' : ''}
        AND NOT EXISTS (
              SELECT 1 FROM pages par
               WHERE par.id = p.parent_id AND par.deleted_batch = p.deleted_batch)
      ORDER BY p.deleted_at DESC`, vis ? [vis] : [])).rows);
}));

router.post('/pages/:id/restore', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const target = (await q(
    'SELECT id, parent_id, space_id, deleted_batch FROM pages WHERE id = $1 AND deleted_at IS NOT NULL',
    [id])).rows[0];
  if (!target) return res.status(404).json({ error: 'not in trash' });
  const role = await spaceRole(req.userEmail, target.space_id);
  if (!role || ROLE_RANK[role] < 2 || await pageRestrictionBlocks(req.userEmail, target.id, role))
    return res.status(403).json({ error: 'forbidden' });

  // A page whose parent is still in the trash would come back invisible --
  // present in the tree query, reachable from nothing. Say so instead.
  if (target.parent_id) {
    const parent = (await q(
      'SELECT title, deleted_at, deleted_batch FROM pages WHERE id = $1', [target.parent_id])).rows[0];
    if (parent && parent.deleted_at && parent.deleted_batch !== target.deleted_batch) {
      return res.status(409).json({
        error: `Restore "${parent.title}" first -- this page lives inside it.` });
    }
  }

  const { rowCount } = await q(
    `UPDATE pages SET deleted_at = NULL, deleted_by = NULL, deleted_batch = NULL
      WHERE deleted_batch = $1`, [target.deleted_batch]);
  res.json({ ok: true, restored: rowCount });
}));

// Version history. The list flags the entry that matches the live page as
// current, so the UI can show "you are here" without a separate lookup.
router.get('/pages/:id/versions', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'view') == null) return;
  // The highest version_no always mirrors the live page (every save writes it,
  // restore forces a new one), so exactly that row is current -- content-equality
  // would flag two rows after restoring to an identical earlier version.
  res.json((await q(
    `SELECT version_no, title, edited_by, created_at,
            (version_no = MAX(version_no) OVER ()) AS is_current
       FROM page_versions WHERE page_id = $1 ORDER BY version_no DESC`, [id])).rows);
}));

router.get('/pages/:id/versions/:n', wrap(async (req, res) => {
  if (await guardPage(req, res, Number(req.params.id), 'view') == null) return;
  const v = (await q(
    `SELECT version_no, title, body, edited_by, created_at
       FROM page_versions WHERE page_id = $1 AND version_no = $2`,
    [Number(req.params.id), Number(req.params.n)])).rows[0];
  if (!v) return res.status(404).json({ error: 'version not found' });
  res.json(v);
}));

router.post('/pages/:id/versions/:n/restore', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  const v = (await q(
    'SELECT title, body FROM page_versions WHERE page_id = $1 AND version_no = $2',
    [id, Number(req.params.n)])).rows[0];
  if (!v) return res.status(404).json({ error: 'version not found' });
  const { rows } = await q(
    `UPDATE pages SET title = $2, body = $3, updated_by = $4, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, v.title, v.body, req.userEmail]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  // The restore is itself a version, so history stays honest and the state you
  // restored *from* remains above it rather than being overwritten in place.
  await recordVersion(id, rows[0].title, rows[0].body, req.userEmail, { force: true });
  res.json(rows[0]);
}));

router.post('/pages/:id/labels', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const name = normLabel((req.body || {}).name);
  if (!name) return res.status(400).json({ error: 'label name required' });
  if (await guardPage(req, res, id, 'edit') == null) return;
  const lab = (await q(
    `INSERT INTO labels (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name])).rows[0];
  await q('INSERT INTO page_labels (page_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [id, lab.id]);
  res.json(await pageLabels(id));
}));

router.delete('/pages/:id/labels/:labelId', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  await q('DELETE FROM page_labels WHERE page_id = $1 AND label_id = $2', [id, Number(req.params.labelId)]);
  res.json(await pageLabels(id));
}));

router.get('/pages/:id/restrictions', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  res.json(await pageRestrictedTo(id));
}));
router.post('/pages/:id/restrictions', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  if (!email.includes('@')) return res.status(400).json({ error: 'valid email required' });
  const before = await pageRestrictedTo(id);
  await q('INSERT INTO page_restrictions (page_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [id, email, req.userEmail]);
  // First restriction keeps the actor on the list so they can't lock themselves out.
  if (before.length === 0 && email !== String(req.userEmail).toLowerCase())
    await q('INSERT INTO page_restrictions (page_id, email, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, String(req.userEmail).toLowerCase(), req.userEmail]);
  res.json(await pageRestrictedTo(id));
}));
router.delete('/pages/:id/restrictions/:email', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  await q('DELETE FROM page_restrictions WHERE page_id = $1 AND email = $2',
    [id, String(req.params.email).toLowerCase()]);
  res.json(await pageRestrictedTo(id));
}));

router.get('/pages/:id/comments', wrap(async (req, res) => {
  if (await guardPage(req, res, Number(req.params.id), 'view') == null) return;
  res.json((await q(
    `SELECT id, page_id, parent_id, author, body, resolved, resolved_by, created_at, updated_at
       FROM comments WHERE page_id = $1 AND held_deleted_at IS NULL ORDER BY created_at`, [Number(req.params.id)])).rows);
}));

router.post('/pages/:id/comments', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { body, parentId = null } = req.body || {};
  if (!String(body || '').trim()) return res.status(400).json({ error: 'comment body required' });
  const sid = await guardPage(req, res, id, 'edit');
  if (sid == null) return;
  // A reply must target a comment on THIS page; replying to a reply attaches to
  // its root so threads stay one level deep.
  let pid = null;
  if (parentId) {
    const parent = (await q('SELECT id, page_id, parent_id FROM comments WHERE id = $1 AND held_deleted_at IS NULL', [Number(parentId)])).rows[0];
    if (!parent || Number(parent.page_id) !== id) return res.status(400).json({ error: 'bad parent' });
    pid = parent.parent_id || parent.id;
  }
  const { rows } = await q(
    `INSERT INTO comments (page_id, parent_id, author, body) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, pid, req.userEmail, String(body).trim()]);
  const c = rows[0];

  // Notify @mentions (full-email form) and, for a reply, the root comment author.
  // createNotification skips self and anyone who can't view the page.
  const notified = new Set();
  for (const m of String(body).matchAll(/@([\w.+-]+@[\w.-]+\.\w+)/g)) {
    const e = m[1].toLowerCase();
    if (notified.has(e)) continue;
    notified.add(e);
    await createNotification(e, req.userEmail, 'mention', id, c.id, body, sid);
  }
  if (pid) {
    const root = (await q('SELECT author FROM comments WHERE id = $1', [pid])).rows[0];
    if (root && root.author && !notified.has(root.author.toLowerCase())) {
      await createNotification(root.author, req.userEmail, 'reply', id, c.id, body, sid);
    }
  }
  res.json(c);
}));

router.patch('/comments/:id', wrap(async (req, res) => {
  const { body, resolved } = req.body || {};
  const c = (await q('SELECT id, page_id, parent_id FROM comments WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!c) return res.status(404).json({ error: 'not found' });
  if (await guardPage(req, res, c.page_id, 'edit') == null) return;
  if (resolved != null && c.parent_id != null)
    return res.status(400).json({ error: 'only a top-level comment can be resolved' });
  const { rows } = await q(
    `UPDATE comments SET body = COALESCE($2, body),
        resolved = COALESCE($3, resolved),
        resolved_by = CASE WHEN $3 IS NULL THEN resolved_by WHEN $3 THEN $4 ELSE NULL END,
        updated_at = now()
      WHERE id = $1 RETURNING *`,
    [c.id, body != null ? String(body) : null,
     resolved != null ? Boolean(resolved) : null, req.userEmail]);
  res.json(rows[0]);
}));

router.delete('/comments/:id', wrap(async (req, res) => {
  const c = (await q('SELECT page_id FROM comments WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!c) return res.json({ ok: true });
  if (await guardPage(req, res, c.page_id, 'edit') == null) return;
  await compliance.deleteComment(Number(req.params.id));
  res.json({ ok: true });
}));

// Attachments. Upload is a raw binary body (no multipart dep); the filename
// rides in ?name= and the mime in Content-Type. express.json only parses
// application/json, so a binary upload passes through to this raw parser.
const rawUpload = express.raw({ type: () => true, limit: '12mb' });
router.post('/pages/:id/attachments', rawUpload, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'edit') == null) return;
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) return res.status(400).json({ error: 'empty upload' });
  const name = String(req.query.name || 'file').slice(0, 255);
  const mime = (req.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  const { rows } = await q(
    `INSERT INTO attachments (page_id, filename, mime, size, data, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, filename, mime, size, uploaded_by, created_at`,
    [id, name, mime, buf.length, buf, req.userEmail]);
  res.json(rows[0]);
}));

router.get('/pages/:id/attachments', wrap(async (req, res) => {
  if (await guardPage(req, res, Number(req.params.id), 'view') == null) return;
  res.json(await pageAttachments(Number(req.params.id)));
}));

router.get('/attachments/:id', wrap(async (req, res) => {
  const a = (await q('SELECT page_id, filename, mime, data FROM attachments WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!a) return res.status(404).json({ error: 'not found' });
  if (await guardPage(req, res, a.page_id, 'view') == null) return;
  const inline = /^image\//.test(a.mime) || a.mime === 'application/pdf';
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${String(a.filename).replace(/["\r\n]/g, '')}"`);
  res.send(a.data);
}));

router.delete('/attachments/:id', wrap(async (req, res) => {
  const a = (await q('SELECT page_id FROM attachments WHERE id = $1 AND held_deleted_at IS NULL', [Number(req.params.id)])).rows[0];
  if (!a) return res.json({ ok: true });
  if (await guardPage(req, res, a.page_id, 'edit') == null) return;
  await compliance.deleteAttachment(Number(req.params.id));
  res.json({ ok: true });
}));

// Word export: render the page markdown to a real .docx (editable in Word).
router.get('/pages/:id/export.docx', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'view') == null) return;
  const p = (await q('SELECT title, body FROM pages WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
  if (!p) return res.status(404).json({ error: 'not found' });
  const HTMLtoDOCX = require('html-to-docx');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${String(p.title).replace(/</g, '&lt;')}</title></head>`
    + `<body><h1>${String(p.title).replace(/</g, '&lt;')}</h1>${mdToHtml(p.body)}</body></html>`;
  const out = await HTMLtoDOCX(html, null, { table: { row: { cantSplit: true } } });
  let buf;
  if (Buffer.isBuffer(out)) buf = out;
  else if (out && typeof out.arrayBuffer === 'function') buf = Buffer.from(await out.arrayBuffer());
  else buf = Buffer.from(out);
  const safe = (String(p.title).replace(/[^\w.-]+/g, '_').slice(0, 80)) || 'page';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
  res.send(buf);
}));

// High-fidelity PDF: render → .docx → the shared LibreOffice-backed docx2pdf
// service. 503 if the service isn't configured, 502 if unreachable — the client
// falls back to browser print in either case.
router.get('/pages/:id/export.pdf', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await guardPage(req, res, id, 'view') == null) return;
  // DOCX2PDF_URL is the full convert endpoint (Gotenberg: .../forms/libreoffice/
  // convert; or a synergy docx2pdf /convert). Optional Bearer for the latter.
  const svc = process.env.DOCX2PDF_URL, token = process.env.DOCX2PDF_TOKEN;
  if (!svc) return res.status(503).json({ error: 'pdf-service-unconfigured' });
  const p = (await q('SELECT title, body FROM pages WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
  if (!p) return res.status(404).json({ error: 'not found' });
  const HTMLtoDOCX = require('html-to-docx');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${String(p.title).replace(/</g, '&lt;')}</title></head>`
    + `<body><h1>${String(p.title).replace(/</g, '&lt;')}</h1>${mdToHtml(p.body)}</body></html>`;
  const out = await HTMLtoDOCX(html, null, { table: { row: { cantSplit: true } } });
  const docxBuf = Buffer.isBuffer(out) ? out : (out && out.arrayBuffer ? Buffer.from(await out.arrayBuffer()) : Buffer.from(out));
  const safe = (String(p.title).replace(/[^\w.-]+/g, '_').slice(0, 80)) || 'page';
  try {
    const form = new FormData();
    form.append('files', new Blob([docxBuf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${safe}.docx`);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetch(svc, { method: 'POST', headers, body: form });
    if (!r.ok) return res.status(502).json({ error: 'convert-failed', status: r.status });
    const pdf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(502).json({ error: 'pdf-service-unreachable', detail: String(e.message || e).slice(0, 200) });
  }
}));

// Templates — a shared library, any authenticated user may manage and use them.
router.get('/templates', wrap(async (req, res) => {
  res.json((await q(
    'SELECT id, name, body, created_by, created_at FROM templates ORDER BY lower(name)')).rows);
}));
router.post('/templates', wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await q(
    'INSERT INTO templates (name, body, created_by) VALUES ($1,$2,$3) RETURNING *',
    [name.slice(0, 120), String((req.body || {}).body || ''), req.userEmail]);
  res.json(rows[0]);
}));
router.delete('/templates/:id', wrap(async (req, res) => {
  await q('DELETE FROM templates WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// A notification about a comment that was deleted (and kept for a hold) goes with it.
const LIVE_COMMENT = `NOT EXISTS (SELECT 1 FROM comments c WHERE c.id = n.comment_id AND c.held_deleted_at IS NOT NULL)`;
router.get('/notifications', wrap(async (req, res) => {
  const items = (await q(
    `SELECT n.id, n.actor, n.kind, n.page_id, n.snippet, n.read, n.created_at, p.title AS page_title
       FROM notifications n LEFT JOIN pages p ON p.id = n.page_id
      WHERE n.recipient = $1 AND ${LIVE_COMMENT} ORDER BY n.created_at DESC LIMIT 50`, [req.userEmail])).rows;
  const unread = Number((await q(
    `SELECT count(*) AS n FROM notifications n WHERE recipient = $1 AND read = false AND ${LIVE_COMMENT}`, [req.userEmail])).rows[0].n);
  res.json({ unread, items });
}));
router.post('/notifications/read', wrap(async (req, res) => {
  const id = (req.body || {}).id;
  if (id) await q('UPDATE notifications SET read = true WHERE id = $1 AND recipient = $2', [Number(id), req.userEmail]);
  else await q('UPDATE notifications SET read = true WHERE recipient = $1 AND read = false', [req.userEmail]);
  res.json({ ok: true });
}));

router.get('/search', wrap(async (req, res) => {
  const s = String(req.query.q || '').trim();
  if (s.length < 2) return res.json([]);
  const terms = s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const params = [];
  const p = v => { params.push(v); return '$' + params.length; };

  // Prefix-aware tsquery so "dep" still finds "deploy"; ILIKE keeps substring
  // hits FTS would miss, so we never do worse than the old search.
  const tsq = terms.length ? `to_tsquery('english', ${p(terms.map(t => t + ':*').join(' & '))})` : null;
  const like = p('%' + s + '%');
  const match = tsq
    ? `(p.search_vector @@ ${tsq} OR p.title ILIKE ${like} OR p.body ILIKE ${like})`
    : `(p.title ILIKE ${like} OR p.body ILIKE ${like})`;

  const filters = ['p.deleted_at IS NULL', match];
  const vis = await viewableSpaceIds(req.userEmail); // null = all; restricted spaces never leak via search
  if (vis) {
    filters.push(`p.space_id = ANY(${p(vis)}::bigint[])`);
    const adm = await adminSpaceIds(req.userEmail);
    filters.push(`(NOT EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id)
                   OR EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id AND pr.email = ${p(String(req.userEmail).toLowerCase())})
                   OR p.space_id = ANY(${p(adm)}::bigint[]))`);
  }
  if (req.query.space)  filters.push(`p.space_id = ${p(Number(req.query.space))}`);
  if (req.query.label)  filters.push(`EXISTS (SELECT 1 FROM page_labels pl WHERE pl.page_id = p.id AND pl.label_id = ${p(Number(req.query.label))})`);
  if (req.query.author) filters.push(`lower(p.updated_by) = ${p(String(req.query.author).toLowerCase())}`);

  const rank = tsq ? `ts_rank_cd(p.search_vector, ${tsq})` : '0';

  res.json((await q(
    `SELECT p.id, p.title, p.space_id, LEFT(p.body, 160) AS snippet, ${rank} AS rank
       FROM pages p WHERE ${filters.join(' AND ')}
      ORDER BY rank DESC, p.updated_at DESC LIMIT 30`, params)).rows);
}));

// Suite search for the signed-in person (the Search app calls this with their gateway headers).
const suiteSearch = createSearch({ q, viewableSpaceIds, adminSpaceIds });
router.post('/search', wrap(async (req, res) => {
  try {
    res.json(await suiteSearch(req.userEmail, req.body));
  } catch (e) {
    if (e instanceof SearchInputError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

const compliance = createCompliance({ q, mdToHtml });

async function main() {
  await db.migrate(SCHEMA, 'notes');
  // Seed the default space and adopt every page that predates spaces. Idempotent:
  // the INSERT no-ops once GENERAL exists, and the backfill only touches orphans.
  await q(`INSERT INTO spaces (key, name, created_by)
           VALUES ('GENERAL', 'General', 'system') ON CONFLICT (key) DO NOTHING`);
  const generalId = await generalSpaceId();
  await q('UPDATE pages SET space_id = $1 WHERE space_id IS NULL', [generalId]);
  if (Number((await q('SELECT count(*) AS n FROM pages')).rows[0].n) === 0) {
    await q(`INSERT INTO pages (title, body, updated_by, space_id) VALUES
      ('Welcome', 'This is the Synergy team wiki. Create pages on the left; **bold**, _italic_, \`code\`, # headings, and - lists are supported.', 'system', $1)`,
      [generalId]);
  }

  const app = express();
  baseApp(app, express, '2mb');

  // Admin center over the internal network: COMPLIANCE_TOKEN instead of the gateway identity.
  app.use('/api/compliance', compliance.router);

  app.use('/api', requireUser());
  app.use('/api', router);

  app.use(errorHandler('notes'));

  serveSpa(app, express, path.join(__dirname, '..', 'web', 'dist'), { appId: 'notes' });

  app.listen(PORT, () => console.log(`SynergyNotes listening on :${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
