/**
 * Pipeline math: stage order, default win probabilities and the rollup the dashboard and the
 * board show. No database or React here, so it is tested on its own and shared by both sides.
 */
import { STAGES, type Stage } from "./types";

/** Left-to-right order of the board's columns. */
export const STAGE_ORDER: readonly Stage[] = STAGES;

/** Stages that count as open pipeline. */
export const OPEN_STAGES: Stage[] = ["prospecting", "qualification", "proposal", "negotiation"];

export function isClosedStage(stage: Stage): boolean {
  return stage === "closed_won" || stage === "closed_lost";
}

/** Win probability per stage, used when a deal has none of its own. Moving a deal resets it to this. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

/** A deal's own probability, or its stage's default. */
export function effectiveProbability(stage: Stage, probability: number | null | undefined): number {
  return probability === null || probability === undefined ? STAGE_PROBABILITY[stage] : probability;
}

export interface OppLike {
  stage: Stage;
  amount: string | number | null;
  probability: number | null;
}

export interface StageRollup {
  stage: Stage;
  count: number;
  amount: number;
  weightedAmount: number;
}

export interface PipelineSummary {
  byStage: Record<Stage, StageRollup>;
  /** Open (not closed) deals: the pipeline. */
  openCount: number;
  openAmount: number;
  weightedOpenAmount: number;
  wonCount: number;
  wonAmount: number;
}

function toNumber(amount: string | number | null): number {
  if (amount === null || amount === "") return 0;
  const n = typeof amount === "string" ? Number(amount) : amount;
  return Number.isFinite(n) ? n : 0;
}

/** Per-stage totals plus open and won totals. Weighted amount = amount x effective probability. */
export function computePipelineSummary(opps: OppLike[]): PipelineSummary {
  const byStage = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, { stage, count: 0, amount: 0, weightedAmount: 0 }]),
  ) as Record<Stage, StageRollup>;
  const out: PipelineSummary = { byStage, openCount: 0, openAmount: 0, weightedOpenAmount: 0, wonCount: 0, wonAmount: 0 };

  for (const opp of opps) {
    const bucket = byStage[opp.stage];
    if (!bucket) continue;
    const amount = toNumber(opp.amount);
    const weighted = (amount * effectiveProbability(opp.stage, opp.probability)) / 100;
    bucket.count += 1;
    bucket.amount += amount;
    bucket.weightedAmount += weighted;
    if (opp.stage === "closed_won") {
      out.wonCount += 1;
      out.wonAmount += amount;
    } else if (!isClosedStage(opp.stage)) {
      out.openCount += 1;
      out.openAmount += amount;
      out.weightedOpenAmount += weighted;
    }
  }
  return out;
}
