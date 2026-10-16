/** Dates are plain YYYY-MM-DD strings, compared in UTC so a time zone never moves a day. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday to Friday between two days, both ends included, leaving out company holidays. */
export function businessDays(start: string, end: string, holidays: Iterable<string> = []): number {
  const skip = new Set(holidays);
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !skip.has(d)) n++;
  }
  return n;
}

/** The business days of [start, end] that fall inside [from, to]. */
export function businessDaysWithin(start: string, end: string, from: string, to: string, holidays: Iterable<string> = []): number {
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  return a > b ? 0 : businessDays(a, b, holidays);
}
