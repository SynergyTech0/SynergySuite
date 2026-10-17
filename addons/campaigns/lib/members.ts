/**
 * People in Campaigns. Anyone the suite signs in becomes a member on their first visit. The very
 * first becomes admin; everyone after is a viewer until an admin makes them a marketer, because
 * a marketer can email everyone on every list.
 *
 *   viewer    reads audiences, campaigns and reports
 *   marketer  also edits lists, templates and campaigns, and sends
 *   admin     also the sender settings and people's roles
 */
import { q, tx } from "./db";
import { ROLES, type Ctx, type Member, type Role } from "./types";
import { ForbiddenError, UserError, oneOf } from "./util";

type Row = { email: string; name: string; role: Role; last_seen: Date };
const toMember = (r: Row): Member => ({ email: r.email, name: r.name, role: r.role, lastSeen: new Date(r.last_seen).toISOString() });

/** Records the visit and returns who this person is to Campaigns. */
export async function join(email: string, name: string): Promise<Ctx> {
  const e = email.trim().toLowerCase();
  const existing = await q<Row>(
    "UPDATE members SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END, last_seen = now() WHERE email = $1 RETURNING *",
    [e, name],
  );
  if (existing[0]) return { email: e, name: existing[0].name, role: existing[0].role };
  return tx(async (tq) => {
    // Serializes first visits so two people arriving at once can't both become admin.
    await tq("SELECT pg_advisory_xact_lock(hashtext('campaigns-members'))");
    const [row] = await tq<Row>(
      `INSERT INTO members (email, name, role)
       VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM members) THEN 'viewer' ELSE 'admin' END)
       ON CONFLICT (email) DO UPDATE SET last_seen = now()
       RETURNING *`,
      [e, name],
    );
    return { email: e, name: row.name, role: row.role };
  });
}

export async function list(): Promise<Member[]> {
  return (await q<Row>("SELECT * FROM members ORDER BY lower(name), email")).map(toMember);
}

export function canEdit(ctx: Ctx): boolean {
  return ctx.role === "admin" || ctx.role === "marketer";
}

export function assertCanEdit(ctx: Ctx): void {
  if (!canEdit(ctx)) throw new ForbiddenError("Only marketers and admins can change lists and campaigns. Ask an admin.");
}

export function assertAdmin(ctx: Ctx): void {
  if (ctx.role !== "admin") throw new ForbiddenError("Only a Campaigns admin can do that");
}

export async function setRole(ctx: Ctx, email: string, role: unknown): Promise<Member> {
  assertAdmin(ctx);
  const r = oneOf(role, ROLES, "viewer", "role");
  return tx(async (tq) => {
    await tq("SELECT pg_advisory_xact_lock(hashtext('campaigns-members'))");
    const [target] = await tq<Row>("SELECT * FROM members WHERE email = $1", [email.toLowerCase()]);
    if (!target) throw new UserError("No such person", 404);
    if (target.role === "admin" && r !== "admin") {
      const [{ n }] = await tq<{ n: number }>("SELECT count(*)::int AS n FROM members WHERE role = 'admin'");
      if (n <= 1) throw new UserError("Campaigns needs at least one admin");
    }
    const [row] = await tq<Row>("UPDATE members SET role = $2 WHERE email = $1 RETURNING *", [target.email, r]);
    return toMember(row);
  });
}
