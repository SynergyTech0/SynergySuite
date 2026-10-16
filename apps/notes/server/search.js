// Suite search (POST /api/search, see @synergy/search): the wiki pages the signed-in person can
// open in the app today, by the same rule as GET /api/pages: pages in spaces they can view
// (open spaces, spaces they created or are a member of; global admins see all), minus pages
// restricted to other people unless they administer the space. Trashed pages and earlier
// versions never come back; those are for eDiscovery only.
const { readSearchQuery, queryToSql, snippet, clipText } = require('@synergy/search');

const APP = 'notes';

// Markdown down to plain text, near enough for a snippet.
const plain = md => String(md || '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}(#{1,6}|[-*]\s+(\[[ xX]\]\s+)?|>|:::\w*)\s*/gm, '')
  .replace(/[*_`|]+/g, ' ');

function createSearch({ q, viewableSpaceIds, adminSpaceIds }) {
  return async function search(email, body) {
    const s = readSearchQuery(body);
    if (s.kinds.length && !s.kinds.includes('page')) return { app: APP, results: [] };
    email = String(email).toLowerCase();
    const params = [];
    const p = v => `$${params.push(v)}`;
    const where = ['p.deleted_at IS NULL'];
    const vis = await viewableSpaceIds(email); // null = all (global admin)
    if (vis) {
      where.push(`p.space_id = ANY(${p(vis)}::bigint[])`);
      const adm = await adminSpaceIds(email);
      where.push(`(NOT EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id)
                   OR EXISTS (SELECT 1 FROM page_restrictions pr WHERE pr.page_id = p.id AND pr.email = ${p(email)})
                   OR p.space_id = ANY(${p(adm)}::bigint[]))`);
    }
    const kw = queryToSql(s.parsed, ['p.title', 'p.body'], params.length + 1);
    params.push(...kw.params);
    where.push(kw.sql);
    const { rows } = await q(
      `SELECT p.id, p.space_id, p.title, p.body, p.updated_at, p.updated_by, p.created_by
         FROM pages p WHERE ${where.join(' AND ')}
        ORDER BY p.updated_at DESC, p.id DESC LIMIT ${p(s.limit)}`, params);
    return {
      app: APP,
      results: rows.map(r => ({
        id: `page:${r.id}`,
        kind: 'page',
        title: r.title,
        snippet: snippet(plain(r.body) || r.title, s.parsed),
        date: new Date(r.updated_at).toISOString(),
        // The app opens the page's space and the page from these params.
        url: `/?space=${r.space_id}&page=${r.id}`,
        person: r.created_by || r.updated_by || undefined,
        ...(s.text ? { text: clipText(`${r.title}\n${plain(r.body)}`) } : {}),
      })),
    };
  };
}

module.exports = { createSearch };
