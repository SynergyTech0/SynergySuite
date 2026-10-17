// Accounts: the companies you sell to. Deleting one takes its contacts, deals and their activities with it.
import { visible } from "./access";
import { q, tx } from "./db";
import { assertCanEdit } from "./permissions";
import { OWNER_NAME, audit, merged, ownerFor, type AuditRow } from "./records";
import { contactRow, type ContactRow } from "./contacts";
import { keepHeld } from "./ediscovery";
import { pageSize } from "./paging";
import { oppRow, OPP_SELECT, type OppRow } from "./opportunities";
import * as referrals from "./referrals";
import { ACCOUNT_TYPES, type Account, type Contact, type Ctx, type Opportunity } from "./types";
import { UserError, likeTerm, oneOf, optionalUrl, required, text } from "./util";

type Row = AuditRow & {
  id: string; name: string; industry: string; website: string; phone: string; address: string; type: Account["type"];
  city: string; state: string; postal_code: string; lat: number | null; lng: number | null; details: Record<string, unknown> | null;
};

const SELECT = `SELECT a.*, ${OWNER_NAME("a")} FROM accounts a`;

export function accountRow(ctx: Ctx, r: Row): Account {
  return {
    id: r.id, name: r.name, industry: r.industry, website: r.website, phone: r.phone, address: r.address, type: r.type,
    city: r.city ?? "", state: r.state ?? "", postalCode: r.postal_code ?? "", lat: r.lat ?? null, lng: r.lng ?? null,
    details: Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
    ...audit(ctx, r),
  };
}

function fields(b: Record<string, unknown>) {
  return {
    name: required(b.name, "Account name"),
    industry: text(b.industry, 120),
    website: optionalUrl(b.website),
    phone: text(b.phone, 40),
    address: text(b.address, 500),
    city: text(b.city, 120),
    state: text(b.state, 60),
    postalCode: text(b.postalCode, 20),
    type: oneOf(b.type, ACCOUNT_TYPES, "prospect", "account type"),
  };
}

export type ListAccounts = { q?: string; type?: string; industry?: string; state?: string; mine?: boolean; offset?: number; limit?: number };

export async function list(ctx: Ctx, f: ListAccounts = {}): Promise<Account[]> {
  const params: unknown[] = [];
  const where: string[] = [visible(ctx, "account", "a", params)];
  if (f.q) {
    params.push(likeTerm(f.q));
    // name, industry, website, phone, address, city, state, ZIP and type, trigram-indexed (lib/db.ts)
    where.push(`a.search_text ILIKE $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`a.type = $${params.length}`);
  }
  if (f.industry) {
    params.push(f.industry);
    where.push(`a.industry = $${params.length}`);
  }
  if (f.state) {
    params.push(f.state);
    where.push(`a.state = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`a.owner = $${params.length}`);
  }
  params.push(pageSize(f.limit), Math.max(0, Math.floor(Number(f.offset) || 0)));
  const rows = await q<Row>(
    `${SELECT} WHERE ${where.join(" AND ")} ORDER BY lower(a.name), a.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map((r) => accountRow(ctx, r));
}

export type Facets = { industries: { value: string; count: number }[]; states: { value: string; count: number }[] };

/** The industries and states the visible accounts have, with counts, for the list's filters. */
export async function facets(ctx: Ctx): Promise<Facets> {
  const params: unknown[] = [];
  const seen = visible(ctx, "account", "a", params);
  const of = (col: string) =>
    q<{ value: string; count: number }>(
      `SELECT a.${col} AS value, count(*)::int AS count FROM accounts a WHERE a.${col} <> '' AND ${seen}
       GROUP BY a.${col} ORDER BY a.${col} LIMIT 300`,
      params,
    );
  const [industries, states] = await Promise.all([of("industry"), of("state")]);
  return { industries, states };
}

async function load(ctx: Ctx, id: string): Promise<Row> {
  const params: unknown[] = [id];
  const [row] = await q<Row>(`${SELECT} WHERE a.id = $1 AND ${visible(ctx, "account", "a", params)}`, params);
  if (!row) throw new UserError("Account not found", 404);
  return row;
}

export async function get(ctx: Ctx, id: string): Promise<Account & { contacts: Contact[]; opportunities: Opportunity[] }> {
  const row = await load(ctx, id);
  const cp: unknown[] = [id, row.name];
  const contacts = await q<ContactRow>(
    `SELECT c.*, $2::text AS account_name, ${OWNER_NAME("c")} FROM contacts c
     WHERE c.account_id = $1 AND ${visible(ctx, "contact", "c", cp)} ORDER BY lower(c.name)`,
    cp,
  );
  const op: unknown[] = [id];
  const opps = await q<OppRow>(
    `${OPP_SELECT} WHERE o.account_id = $1 AND ${visible(ctx, "opportunity", "o", op)} ORDER BY o.close_date NULLS LAST, lower(o.name)`,
    op,
  );
  return { ...accountRow(ctx, row), contacts: contacts.map((c) => contactRow(ctx, c)), opportunities: opps.map((o) => oppRow(ctx, o)) };
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Account> {
  const v = fields(b);
  const owner = await ownerFor(ctx, b.owner, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO accounts (name, industry, website, phone, address, city, state, postal_code, type, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
    [v.name, v.industry, v.website, v.phone, v.address, v.city, v.state, v.postalCode, v.type, owner, ctx.email],
  );
  return accountRow(ctx, await load(ctx, row.id));
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Account> {
  const cur = await load(ctx, id);
  assertCanEdit(ctx, cur);
  const v = fields(merged({
    name: cur.name, industry: cur.industry, website: cur.website, phone: cur.phone, address: cur.address,
    city: cur.city, state: cur.state, postalCode: cur.postal_code, type: cur.type,
  }, b));
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE accounts SET name=$2, industry=$3, website=$4, phone=$5, address=$6, city=$7, state=$8, postal_code=$9, type=$10, owner=$11,
            updated_by=$12, updated_at=now()
     WHERE id = $1`,
    [id, v.name, v.industry, v.website, v.phone, v.address, v.city, v.state, v.postalCode, v.type, owner, ctx.email],
  );
  return accountRow(ctx, await load(ctx, id));
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  const cur = await load(ctx, id);
  assertCanEdit(ctx, cur);
  await tx(async (tq) => {
    // Activities point at records by id with no foreign key, so they go explicitly.
    const activities = `(t.related_type = 'account' AND t.related_id = $1)
         OR (t.related_type = 'contact' AND t.related_id IN (SELECT id FROM contacts WHERE account_id = $1))
         OR (t.related_type = 'opportunity' AND t.related_id IN (SELECT id FROM opportunities WHERE account_id = $1))`;
    // What belongs to someone on legal hold is kept for eDiscovery first.
    await keepHeld(tq, ctx.email, "activity", activities, [id]);
    await keepHeld(tq, ctx.email, "contact", "t.account_id = $1", [id]);
    await keepHeld(tq, ctx.email, "opportunity", "t.account_id = $1", [id]);
    await keepHeld(tq, ctx.email, "account", "t.id = $1", [id]);
    await tq(`DELETE FROM activities t WHERE ${activities}`, [id]);
    await referrals.dropWith(tq, "opportunity", "SELECT id FROM opportunities WHERE account_id = $1", [id]);
    await tq("DELETE FROM accounts WHERE id = $1", [id]);
  });
}
