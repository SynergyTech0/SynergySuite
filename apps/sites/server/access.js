// Who may do what on a site (SharePoint site permissions).
//
// - owner:   everything, including settings, permissions, publishing and deleting the site
// - member:  edit pages and add documents
// - visitor: read pages and documents
//
// A person's role is the best of: their own grant, a grant to a group they're in ("group:<id>"),
// the site's team (group owners are owners, group members are members), and, on a site that isn't
// private, visitor for everyone signed in.
const { groupsOf } = require('./groups');

const ROLES = ['visitor', 'member', 'owner'];
const rank = r => ROLES.indexOf(r);
const best = (...roles) => roles.filter(r => rank(r) >= 0).sort((a, b) => rank(b) - rank(a))[0] || null;
const atLeast = (role, need) => rank(role) >= rank(need);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** The principals that stand for `email` in grants, and their groups. */
async function whoIs(email) {
  const e = String(email || '').toLowerCase();
  const groups = await groupsOf(e);
  return { email: e, groups, principals: [e, ...groups.map(g => `group:${g.id}`)] };
}

async function roleOn(q, who, site) {
  const grants = (await q(
    'SELECT role FROM site_members WHERE site_id = $1 AND principal = ANY($2::text[])',
    [site.id, who.principals])).rows.map(r => r.role);
  const team = site.group_id ? who.groups.find(g => g.id === String(site.group_id)) : null;
  return best(
    ...grants,
    team ? (team.role === 'owner' ? 'owner' : 'member') : null,
    site.private ? null : 'visitor',
  );
}

/** The site and the person's role on it; 404 when they can't see it, 403 when the role is too low. */
async function siteAccess(q, email, siteId, need = 'visitor') {
  const site = (await q('SELECT * FROM sites WHERE id = $1', [Number(siteId)])).rows[0];
  if (!site) throw httpError(404, 'not found');
  const role = await roleOn(q, await whoIs(email), site);
  if (!role) throw httpError(404, 'not found');
  if (!atLeast(role, need)) {
    throw httpError(403, need === 'owner' ? 'Only the site\'s owners can do that' : 'You can only view this site');
  }
  return { site, role };
}

async function pageAccess(q, email, pageId, need = 'visitor') {
  const page = (await q('SELECT * FROM pages WHERE id = $1', [Number(pageId)])).rows[0];
  if (!page) throw httpError(404, 'not found');
  return { page, ...(await siteAccess(q, email, page.site_id, need)) };
}

/**
 * SQL (and its parameters, numbered from `first`) for "sites this person can see", over a sites
 * table aliased `alias`.
 */
function visibleSql(who, alias = 's', first = 1) {
  const p = `$${first}`;
  const g = `$${first + 1}`;
  return {
    sql: `(NOT ${alias}.private
           OR ${alias}.group_id = ANY(${g}::text[])
           OR EXISTS (SELECT 1 FROM site_members m WHERE m.site_id = ${alias}.id AND m.principal = ANY(${p}::text[])))`,
    params: [who.principals, who.groups.map(g2 => g2.id)],
  };
}

module.exports = { ROLES, best, atLeast, whoIs, roleOn, siteAccess, pageAccess, visibleSql, httpError };
