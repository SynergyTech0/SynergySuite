// Each site's document library is a Drive shared library (Drive's /api/svc/managed-libraries, Bearer
// DRIVE_SVC_TOKEN). Sites decides who is in it: the site's owners, members and visitors become the
// library's owners, editors and viewers, with groups expanded to their people, and Drive leaves
// those libraries' membership to Sites. Files themselves (uploads, versions, previews, sharing
// links, recycle bin, eDiscovery) stay Drive's.
//
// Group membership changes in the Groups app, so sites with group grants are re-synced every few
// minutes as well as on every change made here.
const { groupMembers } = require('./groups');

const DRIVE_ROLE = { owner: 'owner', member: 'editor', visitor: 'viewer' };
const RANK = { viewer: 0, editor: 1, owner: 2 };

const driveUrl = () => (process.env.SITES_DRIVE_URL || '').replace(/\/$/, '');
const token = () => process.env.DRIVE_SVC_TOKEN || '';
const linked = () => !!driveUrl() && !!token();

/** Where people open the library in Drive (the public address, not the internal one). */
function libraryWebUrl(libraryId) {
  const pub = (process.env.SITES_DRIVE_PUBLIC_URL || '').replace(/\/$/, '')
    || (process.env.SUITE_DOMAIN ? `https://drive.${process.env.SUITE_DOMAIN}` : '');
  return pub ? `${pub}/?library=${encodeURIComponent(libraryId)}` : '';
}

async function call(method, path, body) {
  const res = await fetch(`${driveUrl()}/api/svc/managed-libraries${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = res.status === 409 || res.status === 404 ? res.status : 502;
    throw Object.assign(new Error(res.status === 401 ? 'Drive refused Sites: check DRIVE_SVC_TOKEN matches on both apps' : (data.error || `Drive answered ${res.status}`)), { status });
  }
  return data;
}

/**
 * The library's people for a site: { email: driveRole }. Throws when a group can't be looked up,
 * so nobody is dropped from a library because the Groups app was briefly away.
 */
async function libraryMembers(q, site) {
  const out = new Map();
  const give = (email, role) => {
    if (!email) return;
    const r = DRIVE_ROLE[role];
    if (!out.has(email) || RANK[r] > RANK[out.get(email)]) out.set(email, r);
  };
  if (site.group_id) {
    const g = await groupMembers(site.group_id);
    g.owners.forEach(e => give(e, 'owner'));
    g.members.forEach(e => give(e, 'member'));
  }
  const grants = (await q('SELECT principal, role FROM site_members WHERE site_id = $1', [site.id])).rows;
  for (const { principal, role } of grants) {
    if (principal.startsWith('group:')) {
      const g = await groupMembers(principal.slice(6));
      [...g.owners, ...g.members].forEach(e => give(e, role));
    } else {
      give(principal, role);
    }
  }
  return [...out].map(([email, role]) => ({ email, role }));
}

async function createLibrary(q, site) {
  if (!linked() || site.library_id) return site;
  const members = await libraryMembers(q, site);
  const lib = await call('POST', '', {
    name: site.name, description: `Documents for the ${site.name} site`, managedBy: `sites:${site.id}`, members,
  });
  return (await q('UPDATE sites SET library_id = $2 WHERE id = $1 RETURNING *', [site.id, lib.id])).rows[0];
}

/** Brings the library's name and people in line with the site. Logs and keeps going on failure. */
async function syncLibrary(q, site) {
  if (!linked() || !site || !site.library_id) return;
  try {
    const members = await libraryMembers(q, site);
    if (!members.some(m => m.role === 'owner')) return; // never leave Drive a library without owners
    await call('PUT', `/${encodeURIComponent(site.library_id)}`, { name: site.name, members });
  } catch (e) {
    console.error(`[sites] library sync for site ${site.id} failed:`, e.message);
  }
}

/** Deletes the library with the site. Drive refuses (409) while it still holds files. */
async function deleteLibrary(site) {
  if (!linked() || !site.library_id) return;
  try {
    await call('DELETE', `/${encodeURIComponent(site.library_id)}`);
  } catch (e) {
    if (e.status === 404) return;
    if (e.status === 409) throw Object.assign(new Error('Move or delete the site\'s documents first'), { status: 409 });
    throw e;
  }
}

/** A folder of the library (its top when `folder` is empty), as Drive lists it. */
async function listFolder(site, folder) {
  if (!linked() || !site.library_id) return null;
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  return call('GET', `/${encodeURIComponent(site.library_id)}/items${qs}`);
}

/** Re-syncs every library whose people come partly from groups. */
async function syncGroupLibraries(q) {
  if (!linked()) return;
  const { rows } = await q(
    `SELECT * FROM sites s WHERE s.library_id IS NOT NULL
       AND (s.group_id IS NOT NULL OR EXISTS (SELECT 1 FROM site_members m WHERE m.site_id = s.id AND m.principal LIKE 'group:%'))`);
  for (const site of rows) await syncLibrary(q, site);
}

module.exports = { linked, libraryWebUrl, libraryMembers, createLibrary, syncLibrary, deleteLibrary, listFolder, syncGroupLibraries };
