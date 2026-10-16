// POST /api/search: suite-wide search on behalf of the signed-in person (see @synergy/search).
//
// Who can see what: Sites has no per-site sharing or membership. Every signed-in staff member can
// list every site (GET /api/sites), open any site in the editor and preview any page, published or
// not, so search answers with the same: every site and every page, for anyone signed in.
const { readSearchQuery, queryToSql, matchesQuery, snippet, clipText } = require('@synergy/search');

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

async function search(q, body) {
  const s = readSearchQuery(body);
  const want = k => !s.kinds.length || s.kinds.includes(k);
  // The SQL only narrows (positive terms over a superset of the text); the exact check, with any
  // -excluded words, runs on the visible text below.
  const positive = { groups: s.parsed.groups, none: [] };
  const results = [];

  if (want('site')) {
    const f = queryToSql(positive, ['name', 'description', 'slug']);
    const { rows } = await q(`SELECT * FROM sites WHERE ${f.sql} ORDER BY updated_at DESC LIMIT ${SCAN}`, f.params);
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
    const { rows } = await q(
      `SELECT p.*, s.name AS site_name, s.owner_email FROM pages p JOIN sites s ON s.id = p.site_id
        WHERE ${f.sql} ORDER BY p.updated_at DESC LIMIT ${SCAN}`, f.params);
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
