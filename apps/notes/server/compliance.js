// Compliance protocol (see @synergy/compliance): the Admin center searches and exports wiki
// pages over the internal network with COMPLIANCE_TOKEN. Pages are only ever trashed (search
// reports trashed pages as deleted); the app's real deletes, comments and attachments, keep
// their rows when the page owner or the comment's author/uploader is on hold (held_deleted_at,
// hidden everywhere else). Page edits are kept in page_versions; while the page owner or the
// editor is on hold, edits are never folded into the previous version (see holdsEveryVersion),
// and search also matches earlier versions. No retention sweep: pages have no permanent delete.
const express = require('express');
const {
  complianceAuthorized, createPolicyClient, parseQuery, queryToSql,
  MAX_PAGE, MAX_EXPORT_IDS, MAX_ATTACHMENT_BYTES,
} = require('@synergy/compliance');

const APP = 'notes';
const KINDS = ['page'];
const policy = createPolicyClient({ app: APP });

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Validate a SearchRequest. Dates are inclusive: a bare YYYY-MM-DD `to` covers that whole day.
function parseSearch(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('body must be a JSON object');
  if (b.query != null && typeof b.query !== 'string') throw bad('query must be a string');
  const list = (v, name) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw bad(`${name} must be an array of strings`);
    return v.map(x => x.trim().toLowerCase()).filter(Boolean);
  };
  const date = (v, name, end) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (typeof v !== 'string' || isNaN(d)) throw bad(`${name} must be an ISO date`);
    if (!end) return d;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(d.getTime() + 86400000) : new Date(d.getTime() + 1);
  };
  if (b.limit != null && (!Number.isInteger(b.limit) || b.limit < 1)) throw bad('limit must be a positive integer');
  let offset = 0;
  if (b.cursor != null && b.cursor !== '') {
    const raw = typeof b.cursor === 'string' ? Buffer.from(b.cursor, 'base64url').toString() : '';
    if (!/^\d+$/.test(raw)) throw bad('bad cursor');
    offset = Number(raw);
  }
  return {
    query: parseQuery(b.query),
    custodians: list(b.custodians, 'custodians'),
    kinds: list(b.kinds, 'kinds'),
    from: date(b.from, 'from', false),
    to: date(b.to, 'to', true),          // exclusive upper bound
    limit: Math.min(b.limit || 50, MAX_PAGE),
    offset,
  };
}

// Markdown down to plain text, near enough for a snippet.
const plain = md => String(md || '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(#{1,6}|[-*]\s+(\[[ xX]\]\s+)?|>|:::\w*)\s*/gm, '')
  .replace(/[*_`|]+/g, ' ');

// ~200 characters of plain text around the first match, from the first of `texts` (the
// current text, then earlier versions) that has one.
function snippet(texts, parsed) {
  const terms = parsed.groups.flat();
  const all = texts.map(x => plain(x).replace(/\s+/g, ' ').trim());
  const t = all.find(x => terms.some(term => x.toLowerCase().includes(term))) ?? all[0];
  const lower = t.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + t.slice(start, start + 200) + (start + 200 < t.length ? '…' : '');
}

// Every page, trashed or not. The owner is its creator (pages from before created_by existed
// fall back to the last editor); participants are everyone else who edited it.
const ROWS = `
  SELECT p.id, p.parent_id, p.space_id, p.title, p.body, p.created_at, p.updated_at, p.updated_by,
         p.created_by, p.deleted_at, p.deleted_by,
         lower(COALESCE(NULLIF(p.created_by, ''), p.updated_by)) AS owner,
         ARRAY(SELECT DISTINCT lower(e) FROM (
                 SELECT edited_by AS e FROM page_versions v WHERE v.page_id = p.id
                 UNION SELECT p.updated_by) ed
                WHERE e LIKE '%@%' AND lower(e) <> lower(COALESCE(NULLIF(p.created_by, ''), p.updated_by))
                ORDER BY 1) AS participants,
         (SELECT string_agg(v.title || E'\n' || v.body, E'\n' ORDER BY v.version_no)
            FROM page_versions v WHERE v.page_id = p.id) AS history
    FROM pages p`;

function hit(r, parsed) {
  return {
    id: `page:${r.id}`,
    kind: 'page',
    title: r.title,
    owner: r.owner,
    participants: r.participants,
    date: new Date(r.updated_at).toISOString(),
    snippet: snippet([r.body, r.history], parsed),
    size: Buffer.byteLength(r.body),
    ...(r.deleted_at ? { deleted: true } : {}),
  };
}

// Whether an edit must get its own version instead of folding into the editor's last one:
// true while the page owner or the editor is on hold. Shared with the collab server.
async function holdsEveryVersion(q, pageId, editor) {
  const p = (await q(`SELECT COALESCE(NULLIF(created_by, ''), updated_by) AS owner FROM pages WHERE id = $1`, [pageId])).rows[0];
  for (const e of new Set([p && p.owner, editor].filter(Boolean))) if (await policy.onHold(e)) return true;
  return false;
}

function createCompliance({ q, mdToHtml }) {
  async function search(body) {
    const s = parseSearch(body);
    if (s.kinds.length && !s.kinds.some(k => KINDS.includes(k))) return { app: APP, hits: [], total: 0 };
    const params = [];
    const p = v => `$${params.push(v)}`;
    const kw = queryToSql(s.query, ['x.title', 'x.body', 'x.history'], 1);
    params.push(...kw.params);
    const where = [kw.sql];
    if (s.custodians.length) {
      const c = p(s.custodians);
      where.push(`(x.owner = ANY(${c}::text[]) OR x.participants && ${c}::text[])`);
    }
    if (s.from) where.push(`x.updated_at >= ${p(s.from)}`);
    if (s.to) where.push(`x.updated_at < ${p(s.to)}`);
    const base = `FROM (${ROWS}) x WHERE ${where.join(' AND ')}`;
    const total = Number((await q(`SELECT count(*) AS n ${base}`, params)).rows[0].n);
    const rows = (await q(
      `SELECT x.* ${base} ORDER BY x.updated_at DESC, x.id DESC LIMIT ${p(s.limit)} OFFSET ${p(s.offset)}`,
      params)).rows;
    const next = s.offset + rows.length;
    return {
      app: APP,
      hits: rows.map(r => hit(r, s.query)),
      total,
      ...(next < total ? { nextCursor: Buffer.from(String(next)).toString('base64url') } : {}),
    };
  }

  async function exportItems(body) {
    const ids = body && body.ids;
    if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string')) throw bad('ids must be an array of strings');
    if (ids.length > MAX_EXPORT_IDS) throw bad(`at most ${MAX_EXPORT_IDS} ids`);
    const nums = ids.map(id => /^page:(\d+)$/.exec(id)).filter(Boolean).map(m => m[1]);
    if (!nums.length) return { items: [] };
    const rows = (await q(
      `SELECT x.*, s.key AS space_key, s.name AS space_name,
              (SELECT count(*) FROM page_versions v WHERE v.page_id = x.id)::int AS revisions,
              ARRAY(SELECT l.name FROM page_labels pl JOIN labels l ON l.id = pl.label_id
                     WHERE pl.page_id = x.id ORDER BY l.name) AS labels,
              ARRAY(WITH RECURSIVE up AS (
                      SELECT a.id, a.parent_id, a.title, 0 AS depth FROM pages a WHERE a.id = x.parent_id
                      UNION ALL
                      SELECT a.id, a.parent_id, a.title, up.depth + 1 FROM pages a JOIN up ON a.id = up.parent_id
                       WHERE up.depth < 100)
                    SELECT title FROM up ORDER BY depth DESC) AS ancestors
         FROM (${ROWS}) x LEFT JOIN spaces s ON s.id = x.space_id
        WHERE x.id = ANY($1::bigint[]) ORDER BY x.updated_at`, [nums])).rows;
    const items = [];
    const none = parseQuery('');
    for (const r of rows) {
      const comments = (await q(
        `SELECT id, parent_id, author, body, resolved, created_at, updated_at, held_deleted_at
           FROM comments WHERE page_id = $1 ORDER BY created_at`, [r.id])).rows;
      const versions = (await q(
        `SELECT version_no, title, body, edited_by, created_at FROM page_versions
          WHERE page_id = $1 ORDER BY version_no`, [r.id])).rows;
      const files = (await q(
        `SELECT id, filename, mime, size, uploaded_by, created_at, held_deleted_at,
                CASE WHEN size <= $2 THEN data END AS data
           FROM attachments WHERE page_id = $1 ORDER BY created_at`, [r.id, MAX_ATTACHMENT_BYTES])).rows;
      const path = [r.space_name, ...r.ancestors, r.title].filter(Boolean);
      items.push({
        ...hit(r, none),
        app: APP,
        text: r.body,
        html: mdToHtml(r.body),
        metadata: {
          space: { key: r.space_key, name: r.space_name },
          path,
          pathString: path.join(' / '),
          parentId: r.parent_id ? `page:${r.parent_id}` : null,
          revisions: r.revisions,
          // Every saved version but the newest, which mirrors the live page.
          previousVersions: versions.slice(0, -1).map(v => ({
            version: v.version_no, title: v.title, body: v.body, editedBy: v.edited_by, savedAt: v.created_at,
          })),
          labels: r.labels,
          createdBy: r.created_by, createdAt: r.created_at,
          updatedBy: r.updated_by, updatedAt: r.updated_at,
          trashedAt: r.deleted_at, trashedBy: r.deleted_by,
          comments: comments.map(c => ({
            id: Number(c.id), parentId: c.parent_id ? Number(c.parent_id) : null, author: c.author, body: c.body,
            resolved: c.resolved, createdAt: c.created_at, updatedAt: c.updated_at, deletedAt: c.held_deleted_at,
          })),
          attachments: files.map(a => ({ name: a.filename, uploadedBy: a.uploaded_by, createdAt: a.created_at, deletedAt: a.held_deleted_at })),
        },
        attachments: files.map(a => ({
          name: a.filename, type: a.mime, size: a.size,
          ...(a.data ? { base64: a.data.toString('base64') } : { skipped: `larger than ${MAX_ATTACHMENT_BYTES} bytes` }),
        })),
      });
    }
    return { items };
  }

  const pageOwner = async pageId => (await q(
    `SELECT COALESCE(NULLIF(created_by, ''), updated_by) AS owner FROM pages WHERE id = $1`, [pageId])).rows[0]?.owner || '';
  const anyOnHold = async emails => {
    for (const e of new Set(emails.filter(Boolean))) if (await policy.onHold(e)) return true;
    return false;
  };

  // Delete a comment and its replies, unless the page owner or any of their authors is on
  // hold: then they stay, marked held_deleted_at.
  async function deleteComment(id) {
    const thread = (await q(
      'SELECT id, page_id, author FROM comments WHERE (id = $1 OR parent_id = $1) AND held_deleted_at IS NULL', [id])).rows;
    if (!thread.length) return;
    if (await anyOnHold([await pageOwner(thread[0].page_id), ...thread.map(c => c.author)])) {
      await q('UPDATE comments SET held_deleted_at = now() WHERE id = ANY($1::bigint[])', [thread.map(c => c.id)]);
    } else {
      await q('DELETE FROM comments WHERE id = $1', [id]);
    }
  }

  // Delete an attachment, unless its uploader or the page owner is on hold.
  async function deleteAttachment(id) {
    const a = (await q('SELECT page_id, uploaded_by FROM attachments WHERE id = $1 AND held_deleted_at IS NULL', [id])).rows[0];
    if (!a) return;
    if (await anyOnHold([await pageOwner(a.page_id), a.uploaded_by])) {
      await q('UPDATE attachments SET held_deleted_at = now() WHERE id = $1', [id]);
    } else {
      await q('DELETE FROM attachments WHERE id = $1', [id]);
    }
  }

  const router = express.Router();
  router.use((req, res, next) => {
    if (!complianceAuthorized(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  router.post('/search', (req, res, next) => search(req.body).then(r => res.json(r), next));
  router.post('/export', (req, res, next) => exportItems(req.body).then(r => res.json(r), next));

  return { router, deleteComment, deleteAttachment };
}

module.exports = { createCompliance, holdsEveryVersion, policy };
