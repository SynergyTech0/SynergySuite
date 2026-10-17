// Compliance protocol (see @synergy/compliance): the Admin center searches and exports site pages
// over the internal network with COMPLIANCE_TOKEN. A page's owner is its site's owner; its
// participants are the people who created or last edited it. Deleting a page while its owner or
// editors are on hold keeps the row, marked held_deleted_at (hidden everywhere else, reported as
// deleted here), and a site with anyone on hold can't be deleted. Documents live in Drive, which
// answers for them itself. No retention sweep: pages are kept until someone deletes them.
const express = require('express');
const {
  complianceAuthorized, createPolicyClient, parseQuery, queryToSql, MAX_PAGE, MAX_EXPORT_IDS,
} = require('@synergy/compliance');
const { blocksText } = require('./search');

const APP = 'sites';
const KINDS = ['page'];
let policy = createPolicyClient({ app: APP });

/** Swaps the policy client, for tests. */
function setPolicy(p) { policy = p || createPolicyClient({ app: APP }); }

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

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
    to: date(b.to, 'to', true),
    limit: Math.min(b.limit || 50, MAX_PAGE),
    offset,
  };
}

// Every page, deleted under hold or not, with its site.
const ROWS = `
  SELECT p.id, p.site_id, p.slug, p.title, p.blocks, p.updated_at, p.created_by, p.updated_by, p.held_deleted_at,
         s.name AS site_name, s.slug AS site_slug, s.private, s.published,
         lower(s.owner_email) AS owner,
         ARRAY(SELECT DISTINCT lower(e) FROM unnest(ARRAY[p.created_by, p.updated_by]) e
                WHERE e LIKE '%@%' AND lower(e) <> lower(s.owner_email) ORDER BY 1) AS participants,
         p.title || E'\\n' || s.name || E'\\n' || p.blocks::text AS haystack
    FROM pages p JOIN sites s ON s.id = p.site_id`;

function snippet(text, parsed) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = t.toLowerCase();
  let at = -1;
  for (const term of parsed.groups.flat()) {
    const i = lower.indexOf(term);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - 60);
  return (start > 0 ? '…' : '') + t.slice(start, start + 200) + (start + 200 < t.length ? '…' : '');
}

function hit(r, parsed) {
  const text = blocksText(r.blocks);
  return {
    id: `page:${r.id}`,
    kind: 'page',
    title: `${r.title || r.slug} · ${r.site_name}`,
    owner: r.owner,
    participants: r.participants,
    date: new Date(r.updated_at).toISOString(),
    snippet: snippet(text || r.title, parsed),
    size: Buffer.byteLength(text),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

function createCompliance({ q }) {
  async function search(body) {
    const s = parseSearch(body);
    if (s.kinds.length && !s.kinds.some(k => KINDS.includes(k))) return { app: APP, hits: [], total: 0 };
    const params = [];
    const p = v => `$${params.push(v)}`;
    const kw = queryToSql(s.query, ['x.haystack'], 1);
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
    const rows = (await q(`SELECT x.* FROM (${ROWS}) x WHERE x.id = ANY($1::bigint[]) ORDER BY x.updated_at`, [nums])).rows;
    const none = parseQuery('');
    return {
      items: rows.map(r => ({
        ...hit(r, none),
        app: APP,
        text: blocksText(r.blocks),
        metadata: {
          site: { id: Number(r.site_id), name: r.site_name, slug: r.site_slug, private: r.private, published: r.published },
          page: { slug: r.slug, title: r.title },
          blocks: r.blocks,
          createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at,
          deletedAt: r.held_deleted_at,
        },
      })),
    };
  }

  const router = express.Router();
  router.use((req, res, next) => {
    if (!complianceAuthorized(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  router.post('/search', (req, res, next) => search(req.body).then(r => res.json(r), next));
  router.post('/export', (req, res, next) => exportItems(req.body).then(r => res.json(r), next));
  return { router };
}

async function anyOnHold(emails) {
  for (const e of new Set(emails.filter(Boolean).map(x => String(x).toLowerCase()))) {
    if (await policy.onHold(e)) return true;
  }
  return false;
}

/** Deletes a page, or keeps it hidden (held_deleted_at) while its site owner or editors are on hold. */
async function deletePage(q, page, site) {
  if (await anyOnHold([site.owner_email, page.created_by, page.updated_by])) {
    await q('UPDATE pages SET held_deleted_at = now() WHERE id = $1', [page.id]);
  } else {
    await q('DELETE FROM pages WHERE id = $1', [page.id]);
  }
}

/** Whether a site must stay because someone whose pages it holds is on hold. */
async function siteHeld(q, site) {
  const people = (await q(
    'SELECT DISTINCT unnest(ARRAY[created_by, updated_by]) AS e FROM pages WHERE site_id = $1', [site.id])).rows.map(r => r.e);
  return anyOnHold([site.owner_email, ...people]);
}

module.exports = { createCompliance, deletePage, siteHeld, setPolicy, KINDS };
