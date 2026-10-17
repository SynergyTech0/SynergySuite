// The suite's groups (teams, distribution lists, security groups), from the Groups app through
// @synergy/groups. Sites grants access to "group:<id>" principals next to plain emails, and a team
// site belongs to one group: its owners own the site, its members are site members.
//
// Without the package or GROUPS_INTERNAL_URL the suite has no groups: nobody is in any group, so
// group grants give nobody access (they fail closed) and team sites are reached through their
// direct members only.

let client;
function load() {
  if (client !== undefined) return client;
  try {
    client = require('@synergy/groups');
  } catch {
    client = null;
  }
  return client;
}

/** Swaps the groups client, for tests: { groupsOf, groupMembers, addResource? } or null. */
function setGroupsClient(c) { client = c; }

/** The groups `email` belongs to (directly or through nested groups): [{ id, name, kind, role }]. */
async function groupsOf(email) {
  const c = load();
  if (!c || !email) return [];
  try {
    const list = await c.groupsOf(email);
    return Array.isArray(list) ? list.filter(g => g && g.id != null).map(g => ({ ...g, id: String(g.id) })) : [];
  } catch (e) {
    console.error('[sites] groups lookup failed:', e.message);
    return [];
  }
}

const emailOf = m => String(typeof m === 'string' ? m : (m && m.email) || '').trim().toLowerCase();

/**
 * A group's people as { owners: [email], members: [email] }. Throws when the Groups app can't
 * answer, so a caller syncing access never mistakes an outage for an empty group.
 */
async function groupMembers(id) {
  const c = load();
  if (!c) throw new Error('groups are not set up');
  const g = await c.groupMembers(String(id));
  const owners = [...new Set((g && g.owners || []).map(emailOf).filter(Boolean))];
  const members = [...new Set((g && g.members || []).map(emailOf).filter(Boolean))].filter(e => !owners.includes(e));
  return { owners, members };
}

/** Shows the site on the group's team (a Site tab). Best effort: a team without the tab still works. */
async function linkToGroup(groupId, site, url) {
  const resource = { app: 'sites', ref: String(site.id), name: site.name, url };
  const c = load();
  try {
    if (c && typeof c.addResource === 'function') return void await c.addResource(String(groupId), resource);
    const base = (process.env.GROUPS_INTERNAL_URL || '').replace(/\/$/, '');
    if (!base) return;
    const res = await fetch(`${base}/api/svc/groups/${encodeURIComponent(groupId)}/resources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-proxy-auth-secret': process.env.PROXY_SHARED_SECRET || '' },
      body: JSON.stringify(resource),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`groups answered ${res.status}`);
  } catch (e) {
    console.error('[sites] could not add the site to its team:', e.message);
  }
}

module.exports = { groupsOf, groupMembers, linkToGroup, setGroupsClient };
