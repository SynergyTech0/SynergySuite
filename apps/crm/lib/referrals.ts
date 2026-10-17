/**
 * Referrals: which partner sent a lead or deal, and the reward that earns them. A lead or deal
 * records its partner through its own editor (attribute()); converting the lead carries the
 * referral onto the new deal. The stage and the reward are worked out from the lead and deal as
 * they are now (lib/rewards.ts), so there is nothing to keep in step. Marking a reward paid is
 * for the partner's owner or a manager; once paid, who referred the business stays put.
 */
import { visible } from "./access";
import { q, tx, type Tq } from "./db";
import { canEdit, assertCanEdit } from "./permissions";
import { iso } from "./records";
import { referralStage, rewardOf } from "./rewards";
import {
  REFERRAL_STAGES,
  type Ctx, type LeadStatus, type Referral, type ReferralStage, type RewardType, type Stage,
} from "./types";
import { UserError, isUuid, isoDate, likeTerm, money, text } from "./util";

type Row = {
  id: string; partner_id: string; partner_name: string; partner_owner: string; lead_id: string | null; opportunity_id: string | null;
  reward_type: RewardType; reward_value: string; paid_on_day: string | null; paid_amount: string | null; paid_note: string;
  paid_by: string | null; created_at: Date;
  lead_name: string | null; lead_company: string | null; lead_status: LeadStatus | null;
  deal_name: string | null; deal_stage: Stage | null; deal_amount: string | null; account_name: string | null;
};

const SELECT = `SELECT r.*, to_char(r.paid_on, 'YYYY-MM-DD') AS paid_on_day, p.name AS partner_name, p.owner AS partner_owner,
    l.name AS lead_name, l.company AS lead_company, l.status AS lead_status,
    o.name AS deal_name, o.stage AS deal_stage, o.amount AS deal_amount, a.name AS account_name
  FROM referrals r
  JOIN referral_partners p ON p.id = r.partner_id
  LEFT JOIN leads l ON l.id = r.lead_id
  LEFT JOIN opportunities o ON o.id = r.opportunity_id
  LEFT JOIN accounts a ON a.id = o.account_id`;

export function referralRow(ctx: Ctx, r: Row): Referral {
  const stage = referralStage({ leadStatus: r.lead_status, dealStage: r.deal_stage, paid: r.paid_on_day !== null });
  const facts = { stage, rewardType: r.reward_type, rewardValue: r.reward_value, dealValue: r.deal_amount, paidAmount: r.paid_amount };
  return {
    id: r.id, partnerId: r.partner_id, partnerName: r.partner_name, leadId: r.lead_id, opportunityId: r.opportunity_id,
    name: r.deal_name ?? r.lead_name ?? "", company: r.account_name ?? r.lead_company ?? "",
    stage, dealValue: r.deal_amount, rewardType: r.reward_type, rewardValue: r.reward_value, ...rewardOf(facts),
    paidOn: r.paid_on_day, paidAmount: r.paid_amount, paidNote: r.paid_note, paidBy: r.paid_by, createdAt: iso(r.created_at)!,
    payable: canEdit(ctx, { owner: r.partner_owner }),
  };
}

export type ListReferrals = { q?: string; stage?: string; partnerId?: string; unpaid?: boolean };

/** The referrals this person can see, newest first; `unpaid` keeps the won ones still owed a reward. */
export async function list(ctx: Ctx, f: ListReferrals = {}): Promise<Referral[]> {
  const params: unknown[] = [];
  const where = [visible(ctx, "referral", "r", params)];
  if (f.partnerId && isUuid(f.partnerId)) {
    params.push(f.partnerId);
    where.push(`r.partner_id = $${params.length}`);
  }
  if (f.q) {
    params.push(likeTerm(f.q));
    const p = `$${params.length}`;
    where.push(`(p.name ILIKE ${p} OR l.name ILIKE ${p} OR l.company ILIKE ${p} OR o.name ILIKE ${p} OR a.name ILIKE ${p})`);
  }
  const rows = (await q<Row>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.id LIMIT 2000`, params))
    .map((r) => referralRow(ctx, r));
  const stage = REFERRAL_STAGES.includes(f.stage as ReferralStage) ? f.stage : "";
  return rows.filter((r) => (!stage || r.stage === stage) && (!f.unpaid || r.owed !== "0.00"));
}

async function load(ctx: Ctx, id: string, tq: Tq = q, lock = false): Promise<Row> {
  if (!isUuid(id)) throw new UserError("Referral not found", 404);
  const params: unknown[] = [id];
  const [row] = await tq<Row>(`${SELECT} WHERE r.id = $1 AND ${visible(ctx, "referral", "r", params)}${lock ? " FOR UPDATE OF r" : ""}`, params);
  if (!row) throw new UserError("Referral not found", 404);
  return row;
}

export async function get(ctx: Ctx, id: string): Promise<Referral> {
  return referralRow(ctx, await load(ctx, id));
}

/**
 * Records (or changes, or with a blank partner clears) who referred a lead or deal. Call it in the
 * transaction that saves the record, after checking the person may edit it. A new referral takes
 * the partner's default reward.
 */
export async function attribute(ctx: Ctx, tq: Tq, on: "lead" | "opportunity", id: string, partnerId: unknown): Promise<void> {
  const col = on === "lead" ? "lead_id" : "opportunity_id";
  const want = partnerId === null || partnerId === undefined || partnerId === "" ? null : String(partnerId);
  const [cur] = await tq<{ id: string; partner_id: string; paid_on: string | null }>(
    `SELECT id, partner_id, paid_on FROM referrals WHERE ${col} = $1 FOR UPDATE`,
    [id],
  );
  if ((cur?.partner_id ?? null) === want) return;
  if (cur?.paid_on) throw new UserError("The referral reward for this has been paid, so who referred it can't change", 409);
  if (!want) {
    await tq("DELETE FROM referrals WHERE id = $1", [cur!.id]);
    return;
  }
  if (!isUuid(want)) throw new UserError("Pick a referral partner");
  const pp: unknown[] = [want];
  const [partner] = await tq<{ status: string; reward_type: RewardType; reward_value: string }>(
    `SELECT p.status, p.reward_type, p.reward_value FROM referral_partners p WHERE p.id = $1 AND ${visible(ctx, "partner", "p", pp)}`,
    pp,
  );
  if (!partner) throw new UserError("That referral partner no longer exists");
  if (partner.status !== "active") throw new UserError("That referral partner is inactive");
  if (cur) {
    await tq(
      "UPDATE referrals SET partner_id=$2, reward_type=$3, reward_value=$4, updated_by=$5, updated_at=now() WHERE id = $1",
      [cur.id, want, partner.reward_type, partner.reward_value, ctx.email],
    );
  } else {
    await tq(
      `INSERT INTO referrals (partner_id, ${col}, reward_type, reward_value, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5)`,
      [want, id, partner.reward_type, partner.reward_value, ctx.email],
    );
  }
}

/** A lead's referral follows it onto the deal it was converted into. */
export async function carryToDeal(tq: Tq, leadId: string, opportunityId: string): Promise<void> {
  await tq("UPDATE referrals SET opportunity_id = $2, updated_at = now() WHERE lead_id = $1 AND opportunity_id IS NULL", [leadId, opportunityId]);
}

/**
 * Before a lead or deal is deleted: its referral goes too unless the other one of the pair is
 * still there, or the reward was paid (that stays on the partner's record). `where` picks the
 * lead or deal ids, over params from $1.
 */
export async function dropWith(tq: Tq, on: "lead" | "opportunity", where: string, params: unknown[]): Promise<void> {
  const [col, other] = on === "lead" ? ["lead_id", "opportunity_id"] : ["opportunity_id", "lead_id"];
  await tq(`DELETE FROM referrals WHERE ${col} IN (${where}) AND ${other} IS NULL AND paid_on IS NULL`, params);
}

/** Marks a won referral's reward paid: { paidOn (default today), amount (default the reward), note }. */
export async function pay(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Referral> {
  const paidOn = isoDate(b.paidOn, "payment date");
  const amount = money(b.amount);
  const note = text(b.note, 1000);
  await tx(async (tq) => {
    const row = await load(ctx, id, tq, true);
    assertCanEdit(ctx, { owner: row.partner_owner });
    const r = referralRow(ctx, row);
    if (r.paidOn) throw new UserError("This reward is already marked paid", 409);
    if (r.stage !== "won") throw new UserError("A reward is paid once the deal is won");
    await tq(
      "UPDATE referrals SET paid_on = coalesce($2::date, CURRENT_DATE), paid_amount = $3, paid_note = $4, paid_by = $5, updated_by = $5, updated_at = now() WHERE id = $1",
      [id, paidOn, amount ?? r.reward, note, ctx.email],
    );
  });
  return get(ctx, id);
}

/** Undoes a payment recorded by mistake. */
export async function unpay(ctx: Ctx, id: string): Promise<Referral> {
  const row = await load(ctx, id);
  assertCanEdit(ctx, { owner: row.partner_owner });
  await q(
    "UPDATE referrals SET paid_on = NULL, paid_amount = NULL, paid_note = '', paid_by = NULL, updated_by = $2, updated_at = now() WHERE id = $1",
    [id, ctx.email],
  );
  return get(ctx, id);
}

/** A web form lead that came with a partner's code (lib/intake.ts). */
export async function fromWebForm(tq: Tq, partnerId: string, leadId: string): Promise<void> {
  await tq(
    `INSERT INTO referrals (partner_id, lead_id, reward_type, reward_value, created_by, updated_by)
     SELECT p.id, $2, p.reward_type, p.reward_value, 'web form', 'web form' FROM referral_partners p WHERE p.id = $1`,
    [partnerId, leadId],
  );
}
