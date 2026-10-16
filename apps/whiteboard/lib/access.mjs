// Who may do what on a board. Plain JavaScript so the collaboration server (server/collab.mjs)
// and the web app decide access with the same code.

/** Roles on a board, lowest to highest. */
export const RANK = { viewer: 1, editor: 2, owner: 3 };

/** One row that says how person `$2` may use board `$1`. Deleted boards (kept for a hold) have no row. */
export const ACCESS_SQL = `SELECT b.owner, b.link_access, m.role AS member_role
  FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.email = $2
  WHERE b.id = $1 AND b.held_deleted_at IS NULL`;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The best role `email` has on a board from its access row: the owner, a member's own role, or
 * what the board's link gives anyone signed in to the suite. Null means no access.
 */
export function roleFrom(row, email) {
  if (!row) return null;
  if (row.owner === email) return "owner";
  const fromLink = row.link_access === "edit" ? "editor" : row.link_access === "view" ? "viewer" : null;
  const member = row.member_role ?? null;
  if (!member) return fromLink;
  if (!fromLink) return member;
  return RANK[member] >= RANK[fromLink] ? member : fromLink;
}
