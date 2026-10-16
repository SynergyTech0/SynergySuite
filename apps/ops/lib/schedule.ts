/**
 * Asset maths kept free of the database: when a preventive maintenance plan is next due, and an
 * asset's straight-line book value. Books owns the real depreciation once an asset is sent there;
 * this value is what the register shows either way.
 */
import { addDays } from "./plan";

export interface PlanClock {
  intervalDays: number | null;
  intervalMeter: number | null;
  nextDue: string | null;
  nextMeter: number | null;
}

/** Why a plan is due today, or null when it isn't. Days and meter each trigger on their own. */
export function dueReason(plan: PlanClock, today: string, meter: number | null): string | null {
  if (plan.intervalDays && plan.nextDue && plan.nextDue <= today) return `Due ${plan.nextDue}`;
  if (plan.intervalMeter && plan.nextMeter !== null && meter !== null && meter >= plan.nextMeter) return `Meter reached ${plan.nextMeter}`;
  return null;
}

/** The plan's next due date and meter after the work is done on `doneOn` at `meter`. */
export function advance(plan: Pick<PlanClock, "intervalDays" | "intervalMeter">, doneOn: string, meter: number | null): { nextDue: string | null; nextMeter: number | null } {
  return {
    nextDue: plan.intervalDays ? addDays(doneOn, plan.intervalDays) : null,
    nextMeter: plan.intervalMeter && meter !== null ? meter + plan.intervalMeter : null,
  };
}

/** Whole months from `from` to `to` (yyyy-mm-dd), never negative. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const m = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, m);
}

export interface BookValue {
  monthly: number;
  accumulated: number;
  value: number;
}

/** Straight-line depreciation by month down to the salvage value. */
export function bookValue(cost: number | null, salvage: number | null, lifeMonths: number | null, purchased: string | null, today: string): BookValue | null {
  if (!cost || !lifeMonths || !purchased) return null;
  const floor = Math.min(salvage ?? 0, cost);
  const monthly = (cost - floor) / lifeMonths;
  const accumulated = Math.min(cost - floor, monthly * Math.min(lifeMonths, monthsBetween(purchased, today)));
  return { monthly, accumulated, value: cost - accumulated };
}
