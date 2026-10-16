/**
 * Who can open a database, as Lists' "Share" and Access's user permissions: owners (everything,
 * including sharing), editors (data and design) and viewers (read only). A database always keeps
 * at least one owner.
 */
import { getDatabase, tx, type Role } from "./catalog";
import { db } from "./db";
import { FieldValueError } from "./fields";
import { forbidden, HttpError, notFound } from "./http";

export type Member = { email: string; role: Role; addedAt: string };

const ROLES: Role[] = ["owner", "editor", "viewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new FieldValueError("Enter an email address");
  return email;
}

function cleanRole(raw: unknown): Role {
  if (!ROLES.includes(raw as Role)) throw new FieldValueError("Pick owner, editor or viewer");
  return raw as Role;
}

/** Everyone who can open the database; any member may see the list. */
export async function listMembers(databaseId: string, email: string): Promise<Member[]> {
  if (!(await getDatabase(databaseId, email))) throw notFound();
  const { rows } = await db().q(
    `SELECT email, role, added_at FROM base_members WHERE database_id = $1
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email`,
    [databaseId],
  );
  return rows.map((r) => ({ email: r.email, role: r.role, addedAt: new Date(r.added_at).toISOString() }));
}

async function asOwner(databaseId: string, email: string) {
  const info = await getDatabase(databaseId, email);
  if (!info) throw notFound();
  if (info.role !== "owner") throw forbidden("Only an owner can change who has access");
}

/** Gives someone access, or changes the role of someone who has it. */
export async function shareDatabase(databaseId: string, email: string, input: { email?: unknown; role?: unknown }): Promise<Member[]> {
  await asOwner(databaseId, email);
  const who = cleanEmail(input.email);
  const role = cleanRole(input.role ?? "editor");
  await tx(async (c) => {
    // Locks the members so two owners can't demote each other at once.
    const { rows } = await c.query(`SELECT email, role FROM base_members WHERE database_id = $1 FOR UPDATE`, [databaseId]);
    const owners = rows.filter((r) => r.role === "owner").map((r) => r.email);
    if (role !== "owner" && owners.length === 1 && owners[0] === who) throw new HttpError(409, "A database needs an owner; make someone else an owner first");
    await c.query(
      `INSERT INTO base_members (database_id, email, role) VALUES ($1, $2, $3)
       ON CONFLICT (database_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [databaseId, who, role],
    );
  });
  return listMembers(databaseId, email);
}

/** Takes someone's access away; people may also remove themselves. */
export async function unshareDatabase(databaseId: string, email: string, target: unknown): Promise<Member[] | null> {
  const who = cleanEmail(target);
  if (who !== email) await asOwner(databaseId, email);
  else if (!(await getDatabase(databaseId, email))) throw notFound();
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT email, role FROM base_members WHERE database_id = $1 FOR UPDATE`, [databaseId]);
    const owners = rows.filter((r) => r.role === "owner").map((r) => r.email);
    if (owners.length === 1 && owners[0] === who) throw new HttpError(409, "A database needs an owner; make someone else an owner first");
    await c.query(`DELETE FROM base_members WHERE database_id = $1 AND email = $2`, [databaseId, who]);
  });
  return who === email ? null : listMembers(databaseId, email);
}
