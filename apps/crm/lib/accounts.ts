// Accounts: the companies you sell to. Deleting one takes its contacts, deals and their activities with it.
import { visible } from "./access";
import { q, tx } from "./db";
import { assertCanEdit } from "./permissions";
import { OWNER_NAME, audit, merged, ownerFor, type AuditRow } from "./records";
import { contactRow, type ContactRow } from "./contacts";
import { keepHeld } from "./ediscovery";
import { oppRow, OPP_SELECT, type OppRow } from "./opportunities";
import { ACCOUNT_TYPES, type Account, type Contact, type Ctx, type Opportunity } from "./types";
import { UserError, likeTerm, oneOf, optionalUrl, required, text } from "./util";

type Row = AuditRow & { id: string; name: string; industry: string; website: string; phone: string; address: string; type: Account["type"] };

const SELECT = `SELECT a.*, ${OWNER_NAME("a")} FROM accounts a`;

export function accountRow(ctx: Ctx, r: Row): Account {
  return {
    id: r.id, name: r.name, industry: r.industry, website: r.website, phone: r.phone, address: r.address, type: r.type,
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
    type: oneOf(b.type, ACCOUNT_TYPES, "prospect", "account type"),
  };
}

export type ListAccounts = { q?: string; type?: string; mine?: boolean };

export async function list(ctx: Ctx, f: ListAccounts = {}): Promise<Account[]> {
  const params: unknown[] = [];
  const where: string[] = [visible(ctx, "account", "a", params)];
  if (f.q) {
    params.push(likeTerm(f.q));
    where.push(`(a.name ILIKE $${params.length} OR a.industry ILIKE $${params.length} OR a.website ILIKE $${params.length} OR a.phone ILIKE $${params.length})`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`a.type = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`a.owner = $${params.length}`);
  }
  const rows = await q<Row>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY lower(a.name) LIMIT 1000`, params);
  return rows.map((r) => accountRow(ctx, r));
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
    `INSERT INTO accounts (name, industry, website, phone, address, type, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
    [v.name, v.industry, v.website, v.phone, v.address, v.type, owner, ctx.email],
  );
  return accountRow(ctx, await load(ctx, row.id));
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Account> {
  const cur = await load(ctx, id);
  assertCanEdit(ctx, cur);
  const v = fields(merged({ name: cur.name, industry: cur.industry, website: cur.website, phone: cur.phone, address: cur.address, type: cur.type }, b));
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE accounts SET name=$2, industry=$3, website=$4, phone=$5, address=$6, type=$7, owner=$8, updated_by=$9, updated_at=now()
     WHERE id = $1`,
    [id, v.name, v.industry, v.website, v.phone, v.address, v.type, owner, ctx.email],
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
    await tq("DELETE FROM accounts WHERE id = $1", [id]);
  });
}
