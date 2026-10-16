/**
 * Who works the help desk, and what each person can see. Signing in to the suite no longer makes
 * someone staff here: Desk keeps its own list of agents.
 *
 *   admin                 every ticket and article; adds and removes agents
 *   agent, scope "all"    every ticket, internal notes included, and every article, drafts too
 *   agent, scope "assigned"  only the tickets assigned to them (Zendesk's restricted agent)
 *   anyone else           only the tickets they asked for themselves, without internal notes,
 *                         and published articles; they can open a ticket as themselves
 *
 * Desks that existed before agents start with everyone who had worked a ticket, written a canned
 * reply or an article as an agent (see SCHEMA in db.ts). While there is no admin, the first agent
 * to open Desk becomes one, or the first person at all when there are no agents yet.
 */
import { q, tx, type Tq } from "./db";
import { cleanEmail, UserError } from "./util";

export const ROLES = ["admin", "agent"] as const;
export const SCOPES = ["all", "assigned"] as const;
export type Role = (typeof ROLES)[number];
export type Scope = (typeof SCOPES)[number];

/** The signed-in person as Desk sees them. role is null for people who aren't agents. */
export type Viewer = { email: string; name: string; role: Role | null; scope: Scope };

export type Agent = { email: string; name: string; role: Role; scope: Scope; addedBy: string; createdAt: string };

type Row = { email: string; name: string; role: Role; scope: Scope; added_by: string; created_at: Date };
const toAgent = (r: Row): Agent => ({
  email: r.email, name: r.name, role: r.role, scope: r.scope, addedBy: r.added_by, createdAt: new Date(r.created_at).toISOString(),
});

/** Who this person is to Desk; promotes the first admin when the desk has none. */
export async function viewer(me: { email: string; name: string }): Promise<Viewer> {
  const email = me.email.toLowerCase();
  const [row] = await q<Row>("SELECT * FROM agents WHERE email = $1", [email]);
  if (row?.role === "admin") return { email, name: me.name, role: "admin", scope: "all" };
  const [admin] = await q("SELECT 1 FROM agents WHERE role = 'admin' LIMIT 1");
  if (!admin && (row || !(await q("SELECT 1 FROM agents LIMIT 1")).length)) {
    const promoted = await tx(async (tq) => {
      // Serializes first visits so two people arriving at once can't both become admin.
      await tq("SELECT pg_advisory_xact_lock(hashtext('desk-agents'))");
      if ((await tq("SELECT 1 FROM agents WHERE role = 'admin' LIMIT 1")).length) return false;
      await tq(
        `INSERT INTO agents (email, name, role, scope, added_by) VALUES ($1, $2, 'admin', 'all', $1)
         ON CONFLICT (email) DO UPDATE SET role = 'admin', scope = 'all'`,
        [email, me.name],
      );
      return true;
    });
    if (promoted) return { email, name: me.name, role: "admin", scope: "all" };
  }
  if (row && me.name && row.name !== me.name) await q("UPDATE agents SET name = $2 WHERE email = $1", [email, me.name]);
  return row ? { email, name: me.name || row.name, role: row.role, scope: row.scope } : { email, name: me.name, role: null, scope: "assigned" };
}

export const isAgent = (v: Viewer) => v.role !== null;

export function assertAgent(v: Viewer): void {
  if (!isAgent(v)) throw new UserError("Only help desk agents can do that. A Desk admin can add you.", 403);
}

export function assertAdmin(v: Viewer): void {
  if (v.role !== "admin") throw new UserError("Only a Desk admin can do that", 403);
}

/** Agents read internal notes; requesters never do. */
export const seesNotes = (v: Viewer) => isAgent(v);

/** SQL true when `v` can open the ticket aliased `t`; pushes its parameters onto `params`. */
export function ticketVisible(v: Viewer, t: string, params: unknown[]): string {
  if (v.role === "admin" || (v.role === "agent" && v.scope === "all")) return "TRUE";
  const me = `$${params.push(v.email)}`;
  const asked = `lower(${t}.requester_email) = ${me}`;
  return v.role === "agent" ? `(${t}.assignee = ${me} OR ${asked})` : asked;
}

/** SQL true when `v` can read the article aliased `a`: drafts are for agents. */
export function articleVisible(v: Viewer, a: string): string {
  return isAgent(v) ? "TRUE" : `${a}.published`;
}

export async function list(): Promise<Agent[]> {
  return (await q<Row>("SELECT * FROM agents ORDER BY role, lower(coalesce(nullif(name, ''), email))")).map(toAgent);
}

/** Throws unless `email` is an agent; tickets are only assigned to agents. */
export async function assertIsAgent(email: string): Promise<void> {
  if (!(await q("SELECT 1 FROM agents WHERE email = $1", [email.toLowerCase()])).length) {
    throw new UserError(`${email} isn't a help desk agent. A Desk admin can add them.`);
  }
}

function pick<T extends string>(v: unknown, choices: readonly T[], fallback: T, what: string): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (!choices.includes(v as T)) throw new UserError(`Pick a ${what}: ${choices.join(" or ")}`);
  return v as T;
}

/** Adds an agent, or changes one: { email, role?, scope? }. */
export async function save(v: Viewer, input: { email?: unknown; name?: unknown; role?: unknown; scope?: unknown }): Promise<Agent> {
  assertAdmin(v);
  const email = cleanEmail(input.email);
  return tx(async (tq) => {
    await tq("SELECT pg_advisory_xact_lock(hashtext('desk-agents'))");
    const [cur] = await tq<Row>("SELECT * FROM agents WHERE email = $1", [email]);
    const role = pick(input.role, ROLES, cur?.role ?? "agent", "role");
    const scope = role === "admin" ? "all" : pick(input.scope, SCOPES, cur?.scope ?? "all", "scope");
    if (cur?.role === "admin" && role !== "admin") await keepAnAdmin(tq);
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
    const [row] = await tq<Row>(
      `INSERT INTO agents (email, name, role, scope, added_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET role = excluded.role, scope = excluded.scope,
         name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE agents.name END
       RETURNING *`,
      [email, name, role, scope, v.email],
    );
    return toAgent(row);
  });
}

export async function remove(v: Viewer, email: string): Promise<void> {
  assertAdmin(v);
  const e = email.trim().toLowerCase();
  await tx(async (tq) => {
    await tq("SELECT pg_advisory_xact_lock(hashtext('desk-agents'))");
    const [cur] = await tq<Row>("SELECT * FROM agents WHERE email = $1", [e]);
    if (!cur) throw new UserError("No such agent", 404);
    if (cur.role === "admin") await keepAnAdmin(tq);
    await tq("DELETE FROM agents WHERE email = $1", [e]);
  });
}

async function keepAnAdmin(tq: Tq): Promise<void> {
  const [{ n }] = await tq<{ n: number }>("SELECT count(*)::int AS n FROM agents WHERE role = 'admin'");
  if (n <= 1) throw new UserError("The desk needs at least one admin");
}
