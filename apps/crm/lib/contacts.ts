// Contacts: the people at an account.
import { visible } from "./access";
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertCanEdit } from "./permissions";
import { OWNER_NAME, audit, merged, ownerFor, type AuditRow } from "./records";
import type { Contact, Ctx } from "./types";
import { UserError, isUuid, likeTerm, optionalEmail, required, text } from "./util";

export type ContactRow = AuditRow & { id: string; account_id: string; account_name: string; name: string; email: string; phone: string; title: string };

const SELECT = `SELECT c.*, a.name AS account_name, ${OWNER_NAME("c")} FROM contacts c JOIN accounts a ON a.id = c.account_id`;

export function contactRow(ctx: Ctx, r: ContactRow): Contact {
  return {
    id: r.id, accountId: r.account_id, accountName: r.account_name, name: r.name, email: r.email, phone: r.phone, title: r.title,
    ...audit(ctx, r),
  };
}

async function fields(ctx: Ctx, b: Record<string, unknown>) {
  const accountId = String(b.accountId ?? "");
  if (!isUuid(accountId)) throw new UserError("Pick an account");
  const params: unknown[] = [accountId];
  const [acct] = await q(`SELECT 1 FROM accounts a WHERE a.id = $1 AND ${visible(ctx, "account", "a", params)}`, params);
  if (!acct) throw new UserError("That account no longer exists");
  return {
    accountId,
    name: required(b.name, "Contact name"),
    email: optionalEmail(b.email),
    phone: text(b.phone, 40),
    title: text(b.title, 120),
  };
}

export type ListContacts = { q?: string; accountId?: string; mine?: boolean };

export async function list(ctx: Ctx, f: ListContacts = {}): Promise<Contact[]> {
  const params: unknown[] = [];
  const where: string[] = [visible(ctx, "contact", "c", params)];
  if (f.q) {
    params.push(likeTerm(f.q));
    const p = `$${params.length}`;
    where.push(`(c.name ILIKE ${p} OR c.email ILIKE ${p} OR c.title ILIKE ${p} OR c.phone ILIKE ${p} OR a.name ILIKE ${p})`);
  }
  if (f.accountId && isUuid(f.accountId)) {
    params.push(f.accountId);
    where.push(`c.account_id = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`c.owner = $${params.length}`);
  }
  const rows = await q<ContactRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY lower(c.name) LIMIT 1000`, params);
  return rows.map((r) => contactRow(ctx, r));
}

async function load(ctx: Ctx, id: string): Promise<ContactRow> {
  const params: unknown[] = [id];
  const [row] = await q<ContactRow>(`${SELECT} WHERE c.id = $1 AND ${visible(ctx, "contact", "c", params)}`, params);
  if (!row) throw new UserError("Contact not found", 404);
  return row;
}

export async function get(ctx: Ctx, id: string): Promise<Contact> {
  return contactRow(ctx, await load(ctx, id));
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Contact> {
  const v = await fields(ctx, b);
  const owner = await ownerFor(ctx, b.owner, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO contacts (account_id, name, email, phone, title, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
    [v.accountId, v.name, v.email, v.phone, v.title, owner, ctx.email],
  );
  return get(ctx, row.id);
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Contact> {
  const cur = await load(ctx, id);
  assertCanEdit(ctx, cur);
  const v = await fields(ctx, merged({ accountId: cur.account_id, name: cur.name, email: cur.email, phone: cur.phone, title: cur.title }, b));
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE contacts SET account_id=$2, name=$3, email=$4, phone=$5, title=$6, owner=$7, updated_by=$8, updated_at=now() WHERE id = $1`,
    [id, v.accountId, v.name, v.email, v.phone, v.title, owner, ctx.email],
  );
  return get(ctx, id);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx, await load(ctx, id));
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "activity", "t.related_type = 'contact' AND t.related_id = $1", [id]);
    await keepHeld(tq, ctx.email, "contact", "t.id = $1", [id]);
    await tq("DELETE FROM activities WHERE related_type = 'contact' AND related_id = $1", [id]);
    await tq("DELETE FROM contacts WHERE id = $1", [id]);
  });
}
