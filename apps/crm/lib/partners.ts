// Referral partners: the people and companies that send business, and what each referral earns them.
import { visible } from "./access";
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertCanEdit } from "./permissions";
import { OWNER_NAME, audit, merged, ownerFor, type AuditRow } from "./records";
import * as referrals from "./referrals";
import { referralTotals } from "./rewards";
import {
  PARTNER_KINDS, PARTNER_STATUSES, REWARD_TYPES,
  type Ctx, type Partner, type PartnerKind, type PartnerStatus, type Referral, type ReferralTotals, type RewardType,
} from "./types";
import { UserError, isUuid, likeTerm, oneOf, optionalEmail, required, text } from "./util";

type Row = AuditRow & {
  id: string; name: string; kind: PartnerKind; company: string; email: string; phone: string; notes: string; status: PartnerStatus;
  code: string | null; reward_type: RewardType; reward_value: string; contact_id: string | null; account_id: string | null;
  contact_name: string | null; account_name: string | null;
};

/** The linked contact and account are named only for someone who can open them. */
const select = (ctx: Ctx, params: unknown[]) => `SELECT p.*, ${OWNER_NAME("p")},
    (SELECT c.name FROM contacts c WHERE c.id = p.contact_id AND ${visible(ctx, "contact", "c", params)}) AS contact_name,
    (SELECT a.name FROM accounts a WHERE a.id = p.account_id AND ${visible(ctx, "account", "a", params)}) AS account_name
  FROM referral_partners p`;

export function partnerRow(ctx: Ctx, r: Row): Partner {
  return {
    id: r.id, name: r.name, kind: r.kind, company: r.company, email: r.email, phone: r.phone, notes: r.notes, status: r.status,
    code: r.code, rewardType: r.reward_type, rewardValue: r.reward_value,
    contactId: r.contact_name === null ? null : r.contact_id, contactName: r.contact_name ?? "",
    accountId: r.account_name === null ? null : r.account_id, accountName: r.account_name ?? "",
    ...audit(ctx, r),
  };
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

async function fields(ctx: Ctx, b: Record<string, unknown>, id: string | null) {
  const rewardType = oneOf(b.rewardType, REWARD_TYPES, "percent", "reward type");
  const raw = text(b.rewardValue, 40).replace(/[$%,\s]/g, "") || "0";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) throw new UserError("Enter a reward like 10 or 250.50");
  if (rewardType === "percent" && Number(raw) > 100) throw new UserError("A percentage reward is at most 100");
  const code = text(b.code, 40) || null;
  if (code && !CODE.test(code)) throw new UserError("A partner code is 2 to 40 letters, digits, - or _");
  if (code) {
    const [taken] = await q("SELECT 1 FROM referral_partners WHERE lower(code) = lower($1) AND id IS DISTINCT FROM $2::uuid", [code, id]);
    if (taken) throw new UserError(`Another partner already uses the code ${code}`, 409);
  }
  // A link to a contact or account must be to one this person can see.
  const link = async (v: unknown, kind: "contact" | "account", table: string) => {
    if (v === undefined || v === null || v === "") return null;
    const params: unknown[] = [v];
    if (!isUuid(v) || !(await q(`SELECT 1 FROM ${table} t WHERE t.id = $1 AND ${visible(ctx, kind, "t", params)}`, params)).length) {
      throw new UserError(`That ${kind} no longer exists`);
    }
    return v;
  };
  return {
    name: required(b.name, "Partner name"),
    kind: oneOf(b.kind, PARTNER_KINDS, "person", "partner kind"),
    company: text(b.company, 200),
    email: optionalEmail(b.email),
    phone: text(b.phone, 40),
    notes: text(b.notes, 2000),
    status: oneOf(b.status, PARTNER_STATUSES, "active", "status"),
    code,
    rewardType,
    rewardValue: raw,
    contactId: await link(b.contactId, "contact", "contacts"),
    accountId: await link(b.accountId, "account", "accounts"),
  };
}

export type ListPartners = { q?: string; status?: string; mine?: boolean };

export async function list(ctx: Ctx, f: ListPartners = {}): Promise<Partner[]> {
  const params: unknown[] = [];
  const sql = select(ctx, params);
  const where: string[] = [visible(ctx, "partner", "p", params)];
  if (f.q) {
    params.push(likeTerm(f.q));
    const p = `$${params.length}`;
    where.push(`(p.name ILIKE ${p} OR p.company ILIKE ${p} OR p.email ILIKE ${p} OR p.code ILIKE ${p})`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`p.status = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`p.owner = $${params.length}`);
  }
  const rows = await q<Row>(`${sql} WHERE ${where.join(" AND ")} ORDER BY lower(p.name) LIMIT 1000`, params);
  return rows.map((r) => partnerRow(ctx, r));
}

async function load(ctx: Ctx, id: string): Promise<Row> {
  if (!isUuid(id)) throw new UserError("Partner not found", 404);
  const params: unknown[] = [id];
  const sql = select(ctx, params);
  const [row] = await q<Row>(`${sql} WHERE p.id = $1 AND ${visible(ctx, "partner", "p", params)}`, params);
  if (!row) throw new UserError("Partner not found", 404);
  return row;
}

/** The partner with the referrals this person can see, and their totals. */
export async function get(ctx: Ctx, id: string): Promise<Partner & { referrals: Referral[]; totals: ReferralTotals }> {
  const p = partnerRow(ctx, await load(ctx, id));
  const rs = await referrals.list(ctx, { partnerId: id });
  return { ...p, referrals: rs, totals: referralTotals(rs) };
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Partner> {
  const v = await fields(ctx, b, null);
  const owner = await ownerFor(ctx, b.owner, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO referral_partners (name, kind, company, email, phone, notes, status, code, reward_type, reward_value, contact_id, account_id, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING id`,
    [v.name, v.kind, v.company, v.email, v.phone, v.notes, v.status, v.code, v.rewardType, v.rewardValue, v.contactId, v.accountId, owner, ctx.email],
  );
  return partnerRow(ctx, await load(ctx, row.id));
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Partner> {
  const cur = await load(ctx, id);
  assertCanEdit(ctx, cur);
  const v = await fields(ctx, merged({
    name: cur.name, kind: cur.kind, company: cur.company, email: cur.email, phone: cur.phone, notes: cur.notes, status: cur.status,
    code: cur.code as unknown, rewardType: cur.reward_type, rewardValue: cur.reward_value, contactId: cur.contact_id as unknown, accountId: cur.account_id as unknown,
  }, b), id);
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE referral_partners SET name=$2, kind=$3, company=$4, email=$5, phone=$6, notes=$7, status=$8, code=$9, reward_type=$10, reward_value=$11,
       contact_id=$12, account_id=$13, owner=$14, updated_by=$15, updated_at=now() WHERE id = $1`,
    [id, v.name, v.kind, v.company, v.email, v.phone, v.notes, v.status, v.code, v.rewardType, v.rewardValue, v.contactId, v.accountId, owner, ctx.email],
  );
  return partnerRow(ctx, await load(ctx, id));
}

/** Deletes a partner and their unpaid referrals. One with paid rewards on record is set inactive instead. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx, await load(ctx, id));
  await tx(async (tq) => {
    const [paid] = await tq("SELECT 1 FROM referrals WHERE partner_id = $1 AND paid_on IS NOT NULL LIMIT 1", [id]);
    if (paid) throw new UserError("This partner has paid rewards on record. Set them inactive instead.", 409);
    await keepHeld(tq, ctx.email, "activity", "t.related_type = 'partner' AND t.related_id = $1", [id]);
    await keepHeld(tq, ctx.email, "partner", "t.id = $1", [id]);
    await tq("DELETE FROM activities WHERE related_type = 'partner' AND related_id = $1", [id]);
    await tq("DELETE FROM record_shares WHERE kind = 'partner' AND record_id = $1", [id]);
    await tq("DELETE FROM referral_partners WHERE id = $1", [id]);
  });
}

/** The active partner a web form's code names, if any. Unknown and inactive codes are ignored. */
export async function byCode(code: unknown): Promise<string | null> {
  const c = text(code, 40);
  if (!c || !CODE.test(c)) return null;
  const [row] = await q<{ id: string }>("SELECT id FROM referral_partners WHERE lower(code) = lower($1) AND status = 'active'", [c]);
  return row?.id ?? null;
}
