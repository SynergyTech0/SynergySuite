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
  return format(parse(v)) === v;
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return format(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: string): number {
  return parse(day).getUTCDay();
}

export function isWorkday(day: string): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6;
}

/** The Monday of the week `day` is in. Timesheets run Monday to Sunday. */
export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** The first workday on or after `day`. */
export function onWorkday(day: string): string {
  let d = day;
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}

/** The first workday after `day`. */
export function nextWorkday(day: string): string {
  return onWorkday(addDays(day, 1));
}

/** Workdays from `start` to `finish`, both counted (a one-day task is 1). Never less than 1. */
export function workdays(start: string, finish: string): number {
  if (finish < start) return 1;
  let n = 0;
  for (let d = start; d <= finish; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return Math.max(1, n);
}

/** The day a task of `n` workdays that starts on `start` finishes. */
export function finishAfter(start: string, n: number): string {
  let d = onWorkday(start);
  for (let left = Math.max(1, n) - 1; left > 0; left--) d = nextWorkday(d);
  return d;
}

export function dayOf(d: Date | string | null): string | null {
  if (!d) return null;
  return typeof d === "string" ? d.slice(0, 10) : format(d);
}
