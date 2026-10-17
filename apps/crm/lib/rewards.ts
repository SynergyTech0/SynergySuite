/**
 * Referral math: where a referral stands and what its partner has earned. No database or React
 * here, so it is tested on its own. Money is numeric(14,2) text in and out and whole cents in
 * between, so no amount ever passes through a float.
 */
import type { LeadStatus, ReferralStage, ReferralTotals, RewardType, Stage } from "./types";

/** "1234.5" to 123450 cents; null for blank. */
export function cents(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const m = String(v).trim().match(/^(-)?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const n = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -n : n;
}

/** 123450 cents to "1234.50". */
export function fromCents(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/**
 * A referral's stage. A deal decides it once there is one (any open deal counts as qualified);
 * before that the lead does. Without a deal, a paid reward means it was won (its deal has since
 * been deleted), and one whose lead and deal are both gone is lost.
 */
export function referralStage(r: { leadStatus: LeadStatus | null; dealStage: Stage | null; paid: boolean }): ReferralStage {
  if (r.dealStage) return r.dealStage === "closed_won" ? "won" : r.dealStage === "closed_lost" ? "lost" : "qualified";
  if (r.paid) return "won";
  switch (r.leadStatus) {
    case null: return "lost";
    case "qualified":
    case "converted": return "qualified";
    case "unqualified": return "lost";
    default: return "new";
  }
}

/** What a won referral earns: a fixed amount, or a percentage of the deal (rounded half up to the cent). */
export function rewardCents(type: RewardType, value: string, dealValue: string | null): number {
  const v = cents(value) ?? 0;
  if (type === "fixed") return v;
  // value is a percentage in hundredths (12.5% = 1250), so cents * value / 10000.
  return Math.round(((cents(dealValue) ?? 0) * v) / 10000);
}

export type RewardFacts = { stage: ReferralStage; rewardType: RewardType; rewardValue: string; dealValue: string | null; paidAmount: string | null };

/** The reward once won (null before), and what is still owed. */
export function rewardOf(r: RewardFacts): { reward: string | null; owed: string } {
  if (r.stage !== "won") return { reward: null, owed: "0.00" };
  const reward = rewardCents(r.rewardType, r.rewardValue, r.dealValue);
  return { reward: fromCents(reward), owed: r.paidAmount === null ? fromCents(reward) : "0.00" };
}

/** A partner's referrals summed up: earned is what has been paid plus what is owed. */
export function referralTotals(rows: RewardFacts[]): ReferralTotals {
  let paid = 0;
  let owed = 0;
  let won = 0;
  for (const r of rows) {
    if (r.stage === "won") won++;
    if (r.paidAmount !== null) paid += cents(r.paidAmount) ?? 0;
    owed += cents(rewardOf(r).owed) ?? 0;
  }
  return { sent: rows.length, won, earned: fromCents(paid + owed), paid: fromCents(paid), outstanding: fromCents(owed) };
}
