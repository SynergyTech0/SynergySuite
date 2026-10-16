import type { Repeat } from "./types";

/** Dates here are calendar days, YYYY-MM-DD, worked out in UTC so no time zone shifts them. */
function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = parse(v);
  return format(d) === v;
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

/** The same day of the month `n` months on, or the month's last day when it is shorter (Jan 31 → Feb 28). */
function addMonths(day: string, n: number): string {
  const d = parse(day);
  const want = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(want, last));
  return format(first);
}

/** When a repeating task is next due, counted from when this one was due. */
export function nextDue(due: string, repeat: Repeat): string {
  switch (repeat) {
    case "daily":
      return addDays(due, 1);
    case "weekdays": {
      let next = addDays(due, 1);
      while ([0, 6].includes(parse(next).getUTCDay())) next = addDays(next, 1);
      return next;
    }
    case "weekly":
      return addDays(due, 7);
    case "monthly":
      return addMonths(due, 1);
    case "yearly":
      return addMonths(due, 12);
  }
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
