// POST /api/search: suite-wide search on behalf of the signed-in person (see @synergy/search).
//
// Who can see what: the same sites the person sees in the app (GET /api/sites): every site that
// isn't private, and private sites they own, are a member or visitor of, directly or through a
// group, or whose team they're in. Pages deleted under a legal hold are never found here.
const { readSearchQuery, queryToSql, matchesQuery, snippet, clipText } = require('@synergy/search');
const { visibleSql } = require('./access');

const KINDS = ['site', 'page'];
// The most rows read per kind before the text check; the SQL prefilter makes this generous.
const SCAN = 500;

/** The words a page shows, from its blocks (not its URLs or colours). */
function blocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  const out = [];
  for (const b of blocks) {
    const d = (b && b.data) || {};
    for (const k of ['heading', 'subheading', 'text', 'buttonText', 'caption', 'alt']) {
      if (typeof d[k] === 'string' && d[k].trim()) out.push(d[k]);
    }
    if (Array.isArray(d.columns)) {
      for (const c of d.columns) {
        if (c && typeof c.heading === 'string') out.push(c.heading);
        if (c && typeof c.text === 'string') out.push(c.text);
      }
    }
  }
  return out.join('\n');
}

const iso = d => new Date(d).toISOString();

async function search(q, body, who) {
  const s = readSearchQuery(body);
  const want = k => !s.kinds.length || s.kinds.includes(k);
  // The SQL only narrows (positive terms over a superset of the text); the exact check, with any
  // -excluded words, runs on the visible text below.
  const positive = { groups: s.parsed.groups, none: [] };
  const results = [];

  if (want('site')) {
    const f = queryToSql(positive, ['s.name', 's.description', 's.slug']);
    const v = visibleSql(who, 's', f.params.length + 1);
    const { rows } = await q(
      `SELECT * FROM sites s WHERE ${f.sql} AND ${v.sql} ORDER BY s.updated_at DESC LIMIT ${SCAN}`, [...f.params, ...v.params]);
    for (const r of rows) {
      const text = [r.name, r.description, r.slug].filter(Boolean).join('\n');
      if (!matchesQuery(text, s.parsed)) continue;
      results.push({
        id: `site:${r.id}`, kind: 'site', title: r.name,
        snippet: snippet(r.description || `/s/${r.slug}`, s.parsed),
        date: iso(r.updated_at), url: `/?site=${r.id}`, person: r.owner_email,
        ...(s.text ? { text: clipText(text) } : {}),
      });
    }
  }

  if (want('page')) {
    const f = queryToSql(positive, ['p.title', 'p.blocks::text', 's.name']);
    const v = visibleSql(who, 's', f.params.length + 1);
    const { rows } = await q(
      `SELECT p.*, s.name AS site_name, s.owner_email FROM pages p JOIN sites s ON s.id = p.site_id
        WHERE ${f.sql} AND ${v.sql} AND p.held_deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT ${SCAN}`,
      [...f.params, ...v.params]);
    for (const r of rows) {
      const content = blocksText(r.blocks);
      if (!matchesQuery(`${r.title}\n${r.site_name}\n${content}`, s.parsed)) continue;
      results.push({
        id: `page:${r.id}`, kind: 'page', title: `${r.title || r.slug} · ${r.site_name}`,
        snippet: snippet(content || r.title, s.parsed),
        date: iso(r.updated_at), url: `/?site=${r.site_id}&page=${r.id}`, person: r.owner_email,
        ...(s.text ? { text: clipText(content) } : {}),
      });
    }
  }

  results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { app: 'sites', results: results.slice(0, s.limit) };
}

module.exports = { search, blocksText, KINDS };
