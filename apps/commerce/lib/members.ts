/**
 * People in Commerce. Anyone the suite signs in becomes a member on their first visit; the very
 * first one becomes admin (someone has to be able to hand out roles), everyone after is staff.
 *
 *   staff    sells at the register, fulfils online orders, receives deliveries, reads everything
 *   manager  also changes products, prices, vendors, purchase orders and stock, and gives refunds
 *   admin    also changes settings and people's roles
 */
import { q, tx } from "./db";
import { ROLES, type Ctx, type Member, type Role } from "./types";
import { ForbiddenError, UserError, oneOf } from "./util";

type Row = { email: string; name: string; role: Role; last_seen: Date };
const toMember = (r: Row): Member => ({ email: r.email, name: r.name, role: r.role, lastSeen: new Date(r.last_seen).toISOString() });

/** Records the visit and returns who this person is to Commerce. */
export async function join(email: string, name: string): Promise<Ctx> {
  const e = email.trim().toLowerCase();
  const existing = await q<Row>(
    "UPDATE members SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END, last_seen = now() WHERE email = $1 RETURNING *",
    [e, name],
  );
  if (existing[0]) return { email: e, name: existing[0].name, role: existing[0].role };
  return tx(async (tq) => {
    // Serializes first visits so two people arriving at once can't both become admin.
    await tq("SELECT pg_advisory_xact_lock(hashtext('commerce-members'))");
    const [row] = await tq<Row>(
      `INSERT INTO members (email, name, role)
       VALUES ($1, $2, CASE WHEN EXISTS (SELECT 1 FROM members) THEN 'staff' ELSE 'admin' END)
       ON CONFLICT (email) DO UPDATE SET last_seen = now()
       RETURNING *`,
      [e, name],
    );
    return { email: e, name: row.name, role: row.role };
  });
}

export function isManager(ctx: Ctx): boolean {
  return ctx.role === "manager" || ctx.role === "admin";
}

export function assertManager(ctx: Ctx): void {
  if (!isManager(ctx)) throw new ForbiddenError("Only a manager can do that");
}

export function assertAdmin(ctx: Ctx): void {
  if (ctx.role !== "admin") throw new ForbiddenError("Only an admin can do that");
}

export async function list(): Promise<Member[]> {
  return (await q<Row>("SELECT * FROM members ORDER BY lower(name), email")).map(toMember);
}

export async function setRole(ctx: Ctx, email: string, role: unknown): Promise<Member> {
  assertAdmin(ctx);
  const r = oneOf(role, ROLES, "staff", "role");
  return tx(async (tq) => {
    await tq("SELECT pg_advisory_xact_lock(hashtext('commerce-members'))");
    const [target] = await tq<Row>("SELECT * FROM members WHERE email = $1", [email.trim().toLowerCase()]);
    if (!target) throw new UserError("No such person", 404);
    if (target.role === "admin" && r !== "admin") {
      const [{ n }] = await tq<{ n: number }>("SELECT count(*)::int AS n FROM members WHERE role = 'admin'");
      if (n <= 1) throw new UserError("Commerce needs at least one admin");
    }
    const [row] = await tq<Row>("UPDATE members SET role = $2 WHERE email = $1 RETURNING *", [target.email, r]);
    return toMember(row);
  });
}
