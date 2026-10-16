// Who may open and change what in Loop. Plain JavaScript so the Next.js routes and the
// collaboration server (server/collab.mjs) apply exactly the same rules.
//
// Every function takes `q(text, params) => Promise<rows>`.

/** @typedef {"owner" | "editor" | "viewer"} Role */
/** @typedef {(text: string, params?: unknown[]) => Promise<any[]>} Query */

export const RANK = { viewer: 1, editor: 2, owner: 3 };

/** The higher of two roles; null counts as nothing. */
export function best(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function canEdit(role) {
  return !!role && RANK[role] >= RANK.editor;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
  return typeof v === "string" && UUID.test(v);
}

/**
 * @param {Query} q
 * @param {string} workspaceId
 * @param {string} email
 * @returns {Promise<Role | null>}
 */
export async function workspaceRole(q, workspaceId, email) {
  if (!isUuid(workspaceId)) return null;
  const [w] = await q(
    `SELECT w.owner, m.role FROM workspaces w
     LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.email = $2
     WHERE w.id = $1 AND w.held_deleted_at IS NULL`,
    [workspaceId, email],
  );
  if (!w) return null;
  return w.owner === email ? "owner" : (w.role ?? null);
}

/** A page carries its workspace's access. */
export async function pageRole(q, pageId, email) {
  if (!isUuid(pageId)) return null;
  const [p] = await q("SELECT workspace_id FROM pages WHERE id = $1 AND held_deleted_at IS NULL", [pageId]);
  return p ? workspaceRole(q, p.workspace_id, email) : null;
}

/**
 * A component's owner, the people added to it, the people in its home workspace, and anyone in
 * the organization when its link is shared that way.
 */
export async function componentRole(q, componentId, email) {
  if (!isUuid(componentId)) return null;
  const [c] = await q(
    `SELECT c.owner, c.workspace_id, c.link_access, m.role FROM components c
     LEFT JOIN component_members m ON m.component_id = c.id AND m.email = $2
     WHERE c.id = $1 AND c.held_deleted_at IS NULL`,
    [componentId, email],
  );
  if (!c) return null;
  if (c.owner === email) return "owner";
  let role = c.role ?? null;
  if (c.workspace_id) {
    const w = await workspaceRole(q, c.workspace_id, email);
    // Owning the workspace makes you an editor of its components, not their owner.
    role = best(role, w === "owner" ? "editor" : w);
  }
  if (c.link_access === "org-edit") role = best(role, "editor");
  else if (c.link_access === "org-view") role = best(role, "viewer");
  return role;
}

/** Collaboration document names are "page:<id>" and "component:<id>". */
export function parseDocName(name) {
  const m = /^(page|component):([0-9a-f-]{36})$/i.exec(String(name ?? ""));
  return m && isUuid(m[2]) ? { kind: /** @type {"page" | "component"} */ (m[1].toLowerCase()), id: m[2].toLowerCase() } : null;
}

export async function documentRole(q, name, email) {
  const d = parseDocName(name);
  if (!d) return null;
  return d.kind === "page" ? pageRole(q, d.id, email) : componentRole(q, d.id, email);
}
