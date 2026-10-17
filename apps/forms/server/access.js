// Who can open a form. The person who made it owns it: they can do everything, including delete
// it and change who it is shared with. Beyond that a form is shared with principals, each as an
// editor (change the form, read and export its responses) or a viewer (read the form and its
// responses, change nothing):
//
//   alice@example.com   one person
//   group:<uuid>        a suite group, once the suite has groups
//   *                   everyone in the organization
//
// Forms made before sharing existed were open to everyone, so they start shared with everyone
// as editors (see SCHEMA in index.js); the owner can take that away.

const ROLES = ['view', 'edit'];
const RANK = { view: 1, edit: 2, owner: 3 };
const EVERYONE = '*';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GROUP = /^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything a signed-in person is reached by: themselves and everyone. Groups join here. */
function principalsFor(email) {
  return [String(email).toLowerCase(), EVERYONE];
}

/**
 * SQL for the person's role on form alias `f` ('owner', 'edit', 'view' or NULL), with $emailAt
 * their email and $principalsAt their principals.
 */
function roleSql(f, emailAt, principalsAt) {
  return `CASE WHEN ${f}.created_by = $${emailAt} THEN 'owner'
    ELSE (SELECT CASE WHEN bool_or(sh.role = 'edit') THEN 'edit' WHEN count(*) > 0 THEN 'view' END FROM form_shares sh WHERE sh.form_id = ${f}.id AND sh.principal = ANY($${principalsAt}::text[])) END`;
}

/** The live forms (alias `f`) the person can open. */
function visibleSql(f, emailAt, principalsAt) {
  return `${f}.held_deleted_at IS NULL AND (${f}.created_by = $${emailAt}
    OR EXISTS (SELECT 1 FROM form_shares sh WHERE sh.form_id = ${f}.id AND sh.principal = ANY($${principalsAt}::text[])))`;
}

/** True when `role` is at least `need`. */
function allows(role, need) {
  return Boolean(role) && RANK[role] >= RANK[need];
}

class ShareError extends Error {}

/** Checks a PUT /forms/:id/shares body: [{ principal, role }]. Duplicates keep the stronger role. */
function cleanShares(list, owner) {
  if (!Array.isArray(list)) throw new ShareError('shares must be a list');
  if (list.length > 200) throw new ShareError('a form can be shared with at most 200 people or groups');
  const out = new Map();
  for (const s of list) {
    const principal = String((s && s.principal) || '').trim().toLowerCase();
    const role = s && s.role;
    if (!ROLES.includes(role)) throw new ShareError(`role must be one of ${ROLES.join(', ')}`);
    if (!(principal === EVERYONE || EMAIL.test(principal) || GROUP.test(principal))) {
      throw new ShareError(`"${principal}" is not an email address, a group or everyone`);
    }
    if (principal === owner) continue; // the owner already has everything
    if (!out.has(principal) || RANK[role] > RANK[out.get(principal)]) out.set(principal, role);
  }
  return [...out].map(([principal, role]) => ({ principal, role }));
}

module.exports = { principalsFor, roleSql, visibleSql, allows, cleanShares, ShareError, EVERYONE, ROLES };
