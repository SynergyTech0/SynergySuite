// Opportunities: deals on an account, moving left to right through the pipeline's stages.
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertCanEdit } from "./permissions";
import { computePipelineSummary, STAGE_PROBABILITY, type PipelineSummary } from "./pipeline";
import { OWNER_NAME, audit, merged, ownerFor, type AuditRow } from "./records";
import { STAGES, type Ctx, type Opportunity, type Stage } from "./types";
import { UserError, isUuid, isoDate, likeTerm, money, oneOf, percent, required } from "./util";

export type OppRow = AuditRow & {
  id: string; account_id: string; account_name: string; name: string; amount: string | null; stage: Stage;
  close_day: string | null; probability: number | null;
};

export const OPP_SELECT = `SELECT o.*, to_char(o.close_date, 'YYYY-MM-DD') AS close_day, a.name AS account_name, ${OWNER_NAME("o")}
  FROM opportunities o JOIN accounts a ON a.id = o.account_id`;

export function oppRow(ctx: Ctx, r: OppRow): Opportunity {
  return {
    id: r.id, accountId: r.account_id, accountName: r.account_name, name: r.name, amount: r.amount, stage: r.stage,
    closeDate: r.close_day, probability: r.probability,
    ...audit(ctx, r),
  };
}

async function fields(b: Record<string, unknown>) {
  const accountId = String(b.accountId ?? "");
  if (!isUuid(accountId)) throw new UserError("Pick an account");
  const [acct] = await q("SELECT 1 FROM accounts WHERE id = $1", [accountId]);
  if (!acct) throw new UserError("That account no longer exists");
  return {
    accountId,
    name: required(b.name, "Opportunity name"),
    amount: money(b.amount),
    stage: oneOf(b.stage, STAGES, "prospecting", "stage"),
    closeDate: isoDate(b.closeDate, "close date"),
    probability: percent(b.probability),
  };
}

export type ListOpps = { q?: string; stage?: string; mine?: boolean; accountId?: string };

export async function list(ctx: Ctx, f: ListOpps = {}): Promise<Opportunity[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    params.push(likeTerm(f.q));
    where.push(`(o.name ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
  }
  if (f.stage === "open") where.push("o.stage NOT IN ('closed_won','closed_lost')");
  else if (f.stage) {
    params.push(f.stage);
    where.push(`o.stage = $${params.length}`);
  }
  if (f.accountId && isUuid(f.accountId)) {
    params.push(f.accountId);
    where.push(`o.account_id = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`o.owner = $${params.length}`);
  }
  const rows = await q<OppRow>(
    `${OPP_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.close_date NULLS LAST, lower(o.name) LIMIT 2000`,
    params,
  );
  return rows.map((r) => oppRow(ctx, r));
}

async function load(id: string): Promise<OppRow> {
  const [row] = await q<OppRow>(`${OPP_SELECT} WHERE o.id = $1`, [id]);
  if (!row) throw new UserError("Opportunity not found", 404);
  return row;
}

export async function get(ctx: Ctx, id: string): Promise<Opportunity> {
  return oppRow(ctx, await load(id));
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Opportunity> {
  const v = await fields(b);
  const owner = await ownerFor(ctx, b.owner, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO opportunities (account_id, name, amount, stage, close_date, probability, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
    [v.accountId, v.name, v.amount, v.stage, v.closeDate, v.probability, owner, ctx.email],
  );
  return get(ctx, row.id);
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Opportunity> {
  const cur = await load(id);
  assertCanEdit(ctx, cur);
  const v = await fields(merged(
    { accountId: cur.account_id, name: cur.name, amount: cur.amount, stage: cur.stage, closeDate: cur.close_day, probability: cur.probability as unknown },
    b,
  ));
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE opportunities SET account_id=$2, name=$3, amount=$4, stage=$5, close_date=$6, probability=$7, owner=$8, updated_by=$9, updated_at=now()
     WHERE id = $1`,
    [id, v.accountId, v.name, v.amount, v.stage, v.closeDate, v.probability, owner, ctx.email],
  );
  return get(ctx, id);
}

/** A move on the board. Like Orbit, it resets the probability to the new stage's default. */
export async function moveStage(ctx: Ctx, id: string, stage: unknown): Promise<Opportunity> {
  const s = oneOf(stage, STAGES, "prospecting", "stage");
  const cur = await load(id);
  assertCanEdit(ctx, cur);
  await q("UPDATE opportunities SET stage=$2, probability=$3, updated_by=$4, updated_at=now() WHERE id = $1", [id, s, STAGE_PROBABILITY[s], ctx.email]);
  return get(ctx, id);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx, await load(id));
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "activity", "t.related_type = 'opportunity' AND t.related_id = $1", [id]);
    await keepHeld(tq, ctx.email, "opportunity", "t.id = $1", [id]);
    await tq("DELETE FROM activities WHERE related_type = 'opportunity' AND related_id = $1", [id]);
    await tq("DELETE FROM opportunities WHERE id = $1", [id]);
  });
}

/** Everyone's pipeline, or one owner's. */
export async function summary(owner?: string): Promise<PipelineSummary> {
  const rows = await q<{ stage: Stage; amount: string | null; probability: number | null }>(
    `SELECT stage, amount, probability FROM opportunities ${owner ? "WHERE owner = $1" : ""}`,
    owner ? [owner] : [],
  );
  return computePipelineSummary(rows);
}
