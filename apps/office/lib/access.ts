import { q } from "@/lib/db";
import type { Identity } from "@/lib/identity";

// Google-style access model.
//   Roles (ascending power): viewer < commenter < editor < owner.
//     viewer    — read only
//     commenter — read + comment
//     editor    — read + comment + edit content
//     owner     — everything, incl. delete / share / change roles
//   A user's effective role on a doc is the strongest of:
//     - owner (owner_email)
//     - a per-person grant (doc_grants)
//     - company access (documents.company_role, when scope='company')
export type Role = "viewer" | "commenter" | "editor" | "owner";
const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return !!role && RANK[role] >= RANK[min];
}
function stronger(a: Role | null, b: Role | null): Role | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export type DocRow = {
  id: string;
  org: string;
  owner_email: string;
  kind: string;
  title: string;
  snippet: string;
  scope: string; // 'private' | 'company'
  company_role: Role | null; // role granted to the whole org when scope='company'
  snapshot: unknown;
  starred: boolean;
};

const COLS = "id, org, owner_email, kind, title, snippet, scope, company_role, snapshot, starred";

export type Access = { doc: DocRow; role: Role };

// The caller's effective access to a doc, or null if they can't see it at all.
export async function docAccess(id: string, me: Identity): Promise<Access | null> {
  if (!me.email) return null;
  const rows = await q<DocRow>(`SELECT ${COLS} FROM documents WHERE id = $1 AND org = $2`, [id, me.org]);
  const doc = rows[0];
  if (!doc) return null;
  if (doc.owner_email === me.email) return { doc, role: "owner" };

  let role: Role | null = null;
  const g = await q<{ role: Role }>(`SELECT role FROM doc_grants WHERE doc_id = $1 AND org = $2 AND email = $3`, [id, me.org, me.email]);
  if (g[0]) role = g[0].role;
  if (doc.scope === "company" && doc.company_role) role = stronger(role, doc.company_role);

  if (!role) return null;
  return { doc, role };
}

// Owner-only gate (delete, share management, ownership).
export async function ownedDoc(id: string, me: Identity): Promise<DocRow | null> {
  if (!me.email) return null;
  const rows = await q<DocRow>(`SELECT ${COLS} FROM documents WHERE id = $1 AND org = $2 AND owner_email = $3`, [id, me.org, me.email]);
  return rows[0] ?? null;
}
