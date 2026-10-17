/**
 * Who can see which records. Managers and admins see everything. What a rep sees is an
 * organization setting an admin picks (rep_read in crm_settings):
 *
 *   own  (the default)  records they own, records shared with them, and what hangs off those:
 *                       an account's contacts and deals, any record's activities. They also see
 *                       an account they own a contact or deal on, so they can work the deal.
 *   all                 every record, as before per-person access existed
 *
 * Sharing gives read access to one record (record_shares); changing it still needs the owner or
 * a manager (permissions.ts). A share's principal is an email, group:<uuid> for a suite group,
 * or * for everyone. Activities are seen by whoever they are assigned to or logged by, too.
 *
 * Every read in the app and in suite search goes through visible(), so the two always agree.
 */
import { q, tx } from "./db";
import { assertCanEdit, isAdmin } from "./permissions";
import { RECORD_TYPES, type Ctx, type RecordType } from "./types";
import { UserError, isUuid, oneOf } from "./util";

export const READ_SCOPES = ["own", "all"] as const;
export type ReadScope = (typeof READ_SCOPES)[number];

export type Kind = RecordType | "activity";

const TABLE: Record<RecordType, string> = { account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GROUP = /^group:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything a person is reached by: themselves and everyone. Suite groups join here. */
export function principalsFor(email: string): string[] {
  return [email.toLowerCase(), "*"];
}

/**
 * SQL that is true when `ctx` can see the `kind` row aliased `alias`. Pushes its parameters onto
 * `params`, so it composes with whatever the caller already has there.
 */
export function visible(ctx: Ctx, kind: Kind, alias: string, params: unknown[]): string {
  if (ctx.role === "manager" || ctx.role === "admin") return "TRUE";
  params.push(ctx.email, principalsFor(ctx.email));
  const me = `$${params.length - 1}`;
  const ps = `$${params.length}::text[]`;
  const shared = (k: RecordType, id: string) =>
    `EXISTS (SELECT 1 FROM record_shares rs WHERE rs.kind = '${k}' AND rs.record_id = ${id} AND rs.principal = ANY(${ps}))`;
  const mine = (k: RecordType, a: string) => `(${a}.owner = ${me} OR ${shared(k, `${a}.id`)})`;
  const account = (a: string) =>
    `(${mine("account", a)}
      OR EXISTS (SELECT 1 FROM contacts vc WHERE vc.account_id = ${a}.id AND ${mine("contact", "vc")})
      OR EXISTS (SELECT 1 FROM opportunities vo WHERE vo.account_id = ${a}.id AND ${mine("opportunity", "vo")}))`;
  // Contacts and deals come with the account they are on, when that account is the rep's own or shared.
  const child = (k: "contact" | "opportunity", a: string) =>
    `(${mine(k, a)} OR EXISTS (SELECT 1 FROM accounts va WHERE va.id = ${a}.account_id AND ${mine("account", "va")}))`;
  const of = (k: RecordType, a: string) =>
    k === "account" ? account(a) : k === "lead" ? mine("lead", a) : child(k, a);
  const rule =
    kind === "activity"
      ? `(${alias}.assignee = ${me} OR ${alias}.created_by = ${me} OR CASE ${alias}.related_type ${RECORD_TYPES.map(
          (k) => `WHEN '${k}' THEN EXISTS (SELECT 1 FROM ${TABLE[k]} vr WHERE vr.id = ${alias}.related_id AND ${of(k, "vr")})`,
        ).join(" ")} ELSE false END)`
      : of(kind, alias);
  return `(EXISTS (SELECT 1 FROM crm_settings st WHERE st.key = 'rep_read' AND st.value = 'all') OR ${rule})`;
}

export async function readScope(): Promise<ReadScope> {
  const [row] = await q<{ value: string }>("SELECT value FROM crm_settings WHERE key = 'rep_read'");
  return row?.value === "all" ? "all" : "own";
}

export async function setReadScope(ctx: Ctx, scope: unknown): Promise<ReadScope> {
  if (!isAdmin(ctx)) throw new UserError("Only an admin can change who reps can see", 403);
  const s = oneOf(scope, READ_SCOPES, "own", "rep read scope");
  await q(
    "INSERT INTO crm_settings (key, value) VALUES ('rep_read', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [s],
  );
  return s;
}

export type Share = { principal: string; name: string };

/** The record, if this person can see it; throws 404 otherwise, the same as a record that isn't there. */
async function sharable(ctx: Ctx, kind: unknown, id: unknown): Promise<{ kind: RecordType; id: string; owner: string }> {
  const k = oneOf(kind, RECORD_TYPES, "account", "record type");
  if (!isUuid(id)) throw new UserError("Not found", 404);
  const params: unknown[] = [id];
  const [row] = await q<{ owner: string }>(`SELECT t.owner FROM ${TABLE[k]} t WHERE t.id = $1 AND ${visible(ctx, k, "t", params)}`, params);
  if (!row) throw new UserError("Not found", 404);
  return { kind: k, id: String(id), owner: row.owner };
}

export async function shares(ctx: Ctx, kind: unknown, id: unknown): Promise<Share[]> {
  const r = await sharable(ctx, kind, id);
  return q<Share>(
    `SELECT rs.principal, coalesce(nullif(m.name, ''), CASE WHEN rs.principal = '*' THEN 'Everyone' ELSE rs.principal END) AS name
     FROM record_shares rs LEFT JOIN members m ON m.email = rs.principal
     WHERE rs.kind = $1 AND rs.record_id = $2 ORDER BY rs.principal = '*' DESC, lower(coalesce(m.name, rs.principal))`,
    [r.kind, r.id],
  );
}

/** Replaces who a record is shared with. The owner or a manager decides. */
export async function setShares(ctx: Ctx, kind: unknown, id: unknown, principals: unknown): Promise<Share[]> {
  const r = await sharable(ctx, kind, id);
  assertCanEdit(ctx, r);
  if (!Array.isArray(principals)) throw new UserError("principals must be a list");
  if (principals.length > 200) throw new UserError("A record can be shared with at most 200 people or groups");
  const clean = new Set<string>();
  for (const p of principals) {
    const v = String(p ?? "").trim().toLowerCase();
    if (!(v === "*" || EMAIL.test(v) || GROUP.test(v))) throw new UserError(`"${v}" is not an email address, a group or everyone`);
    if (v !== r.owner) clean.add(v);
  }
  await tx(async (tq) => {
    await tq("DELETE FROM record_shares WHERE kind = $1 AND record_id = $2", [r.kind, r.id]);
    await tq(
      "INSERT INTO record_shares (kind, record_id, principal, shared_by) SELECT $1, $2, p, $3 FROM unnest($4::text[]) p",
      [r.kind, r.id, ctx.email, [...clean]],
    );
  });
  return shares(ctx, r.kind, r.id);
}
