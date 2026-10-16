import type { FilingStatus } from "./federal";
import { STATE_TABLES, type StateTable } from "./state-tables";

/**
 * State income tax withholding, from each state's published annualized (percentage) method:
 * annualize the period's wages, take off the state's standard deduction, personal exemption and
 * allowances, apply the state's rates, take off any per-allowance credits and divide back to the
 * period. The figures for each state live in state-tables.ts with the year and the publication
 * they come from, so a new year is a data change.
 *
 * Local income taxes (cities, counties, school districts) are not included.
 */

export type { StateTable } from "./state-tables";

/** The state's own withholding certificate (DE 4, IT-2104, G-4 and so on). */
export interface StateW4 {
  /** Filing status on the state form; the federal W-4's when the state has no form of its own. */
  filingStatus: FilingStatus;
  /** Allowances or exemptions claimed on the state form. */
  allowances: number;
  /** Extra withholding each pay period, dollars. */
  extraWithholding: number;
  exempt?: boolean;
}

export function stateTable(state: string): StateTable | null {
  return STATE_TABLES[state.toUpperCase()] ?? null;
}

/** True when the state taxes wages (has a withholding table that isn't "none"). */
export function taxesWages(state: string): boolean {
  const t = stateTable(state);
  return Boolean(t && t.method !== "none");
}

function bracketTax(taxable: number, brackets: { over: number; rate: number }[]): number {
  const sorted = [...brackets].sort((a, b) => a.over - b.over);
  let tax = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i].over;
    const hi = i + 1 < sorted.length ? sorted[i + 1].over : Number.POSITIVE_INFINITY;
    if (taxable <= lo) break;
    tax += (Math.min(taxable, hi) - lo) * sorted[i].rate;
  }
  return tax;
}

/**
 * State income tax to withhold from one paycheck, in cents. `wagesCents` is the period's wages
 * subject to state income tax; `federalCents` is the federal withholding on the same paycheck, for
 * the states whose formula subtracts it.
 */
export function stateWithholding(wagesCents: number, periodsPerYear: number, w4: StateW4, table: StateTable, federalCents = 0): number {
  if (w4.exempt || wagesCents <= 0 || table.method === "none") return 0;
  const status = w4.filingStatus;
  const allowances = Math.max(0, Math.floor(w4.allowances || 0));
  let annual = (wagesCents / 100) * periodsPerYear;
  if (table.federalDeduction) annual -= (federalCents / 100) * periodsPerYear;
  const taxable = Math.max(
    0,
    annual
      - (table.standardDeduction?.[status] ?? table.standardDeduction?.single ?? 0)
      - (table.personalExemption?.[status] ?? table.personalExemption?.single ?? 0)
      - allowances * (table.allowance ?? 0),
  );
  let tax = table.method === "flat"
    ? taxable * (table.flatRate ?? 0)
    : bracketTax(taxable, table.brackets?.[status] ?? table.brackets?.single ?? []);
  tax -= allowances * (table.allowanceCredit ?? 0);
  const perPeriod = Math.max(0, tax) / periodsPerYear;
  return Math.round((perPeriod + Math.max(0, w4.extraWithholding || 0)) * 100);
}
