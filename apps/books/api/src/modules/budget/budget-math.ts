/**
 * Pure budget arithmetic: periods, spreading, actuals by period, variance and forecasts.
 * Kept free of Nest and Prisma so it can be unit tested on its own.
 */

export type BudgetPeriodKind = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type ForecastMethod = 'BUDGET' | 'RUN_RATE' | 'TREND';
export const FORECAST_METHODS: ForecastMethod[] = ['BUDGET', 'RUN_RATE', 'TREND'];

export interface Period {
  index: number;
  label: string;
  start: Date; // first day, UTC midnight
  end: Date; // last day, UTC midnight
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const monthKey = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** First day of the fiscal year that ends in `fiscalYear`, given the month (1-12) the year ends. */
export function fiscalYearStart(fiscalYear: number, fiscalYearEnd = 12): Date {
  return fiscalYearEnd === 12 ? utc(fiscalYear, 0) : utc(fiscalYear - 1, fiscalYearEnd);
}

/** Last day of that fiscal year. */
export function fiscalYearEndDate(fiscalYear: number, fiscalYearEnd = 12): Date {
  const start = fiscalYearStart(fiscalYear, fiscalYearEnd);
  return utc(start.getUTCFullYear(), start.getUTCMonth() + 12, 0);
}

/** How many months a period of this kind spans. */
export const monthsPer = (kind: BudgetPeriodKind) => (kind === 'MONTHLY' ? 1 : kind === 'QUARTERLY' ? 3 : 12);

/** Splits [start, end] into whole calendar months grouped by the period kind. */
export function budgetPeriods(start: Date, end: Date, kind: BudgetPeriodKind): Period[] {
  const first = monthKey(start);
  const last = monthKey(end);
  if (last < first) throw new Error('The budget ends before it starts');
  const step = monthsPer(kind);
  const periods: Period[] = [];
  for (let k = first, i = 0; k <= last; k += step, i++) {
    const y = Math.floor(k / 12);
    const m = k % 12;
    const endKey = Math.min(k + step - 1, last);
    const pEnd = utc(Math.floor(endKey / 12), (endKey % 12) + 1, 0);
    const label =
      kind === 'MONTHLY'
        ? `${MONTHS[m]} ${y}`
        : kind === 'QUARTERLY'
          ? `Q${i + 1} (${MONTHS[m]}–${MONTHS[endKey % 12]})`
          : periods.length === 0 && endKey === last
            ? 'Year'
            : `${MONTHS[m]} ${y}–${MONTHS[endKey % 12]} ${Math.floor(endKey / 12)}`;
    periods.push({ index: i, label, start: utc(y, m), end: pEnd });
  }
  return periods;
}

/** Splits a total evenly across n periods to the cent; the last period takes the rounding. */
export function spread(total: number, n: number): number[] {
  if (n <= 0) return [];
  const each = Math.trunc((total * 100) / n) / 100;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = round2(total - each * (n - 1));
  return out;
}

/** An account's activity on its natural side: debits for assets and expenses, credits otherwise. */
export function naturalAmount(type: AccountKind | string, debit: number, credit: number): number {
  return type === 'ASSET' || type === 'EXPENSE' ? debit - credit : credit - debit;
}

/** Sums monthly ledger activity into budget periods, per account, on each account's natural side. */
export function actualsByPeriod(
  rows: { accountId: string; month: Date; debit: number; credit: number }[],
  periods: Period[],
  typeOf: Map<string, string>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const k = monthKey(r.month);
    const p = periods.find((x) => k >= monthKey(x.start) && k <= monthKey(x.end));
    if (!p) continue;
    const arr = out.get(r.accountId) ?? periods.map(() => 0);
    arr[p.index] = round2(arr[p.index] + naturalAmount(typeOf.get(r.accountId) ?? 'EXPENSE', r.debit, r.credit));
    out.set(r.accountId, arr);
  }
  return out;
}

/**
 * Whether the actual is good news against the budget: more revenue or less expense.
 * Balance sheet lines have no direction, so they return null.
 */
export function isFavorable(type: string, budget: number, actual: number): boolean | null {
  if (type === 'REVENUE') return actual >= budget;
  if (type === 'EXPENSE') return actual <= budget;
  return null;
}

export function variancePercent(budget: number, actual: number): number | null {
  if (budget === 0) return null;
  return round2(((actual - budget) / Math.abs(budget)) * 100);
}

/** Periods that ended on or before asOf count as closed: their actuals replace the plan in a forecast. */
export function closedPeriods(periods: Period[], asOf: Date): number {
  return periods.filter((p) => p.end.getTime() <= asOf.getTime()).length;
}

/**
 * A rolling forecast for one line: actuals for the closed periods, then the rest projected.
 * BUDGET keeps the plan for the rest; RUN_RATE repeats the average closed period;
 * TREND extends a straight line fitted to the closed periods (needs two, else run rate).
 */
export function forecastLine(budget: number[], actual: number[], closed: number, method: ForecastMethod): number[] {
  const n = budget.length;
  const done = actual.slice(0, closed);
  const avg = done.length ? done.reduce((s, x) => s + x, 0) / done.length : 0;
  let slope = 0;
  let intercept = avg;
  if (method === 'TREND' && done.length >= 2) {
    const xs = done.map((_, i) => i);
    const mx = (done.length - 1) / 2;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    slope = xs.reduce((s, x, i) => s + (x - mx) * (done[i] - avg), 0) / sxx;
    intercept = avg - slope * mx;
  }
  return Array.from({ length: n }, (_, i) => {
    if (i < closed) return round2(actual[i] ?? 0);
    if (method === 'BUDGET' || done.length === 0) return round2(budget[i] ?? 0);
    if (method === 'RUN_RATE' || done.length < 2) return round2(avg);
    return round2(intercept + slope * i);
  });
}

export const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Normalizes a line's per-period plan: an explicit list must match the period count; a total is spread. */
export function planFor(n: number, input: { budgetAmount?: number; periodAmounts?: number[] }): number[] {
  if (input.periodAmounts && input.periodAmounts.length) {
    if (input.periodAmounts.length !== n) {
      throw new Error(`Give ${n} period amounts, one for each period in the budget`);
    }
    return input.periodAmounts.map((x) => round2(Number(x) || 0));
  }
  return spread(round2(Number(input.budgetAmount) || 0), n);
}
