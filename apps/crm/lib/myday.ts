/**
 * My Day: splits open items into overdue, today, upcoming and no date by calendar day in the
 * viewer's local time. Pure, so the browser runs it in its own time zone and tests pass a fixed `now`.
 */

export interface DueItem {
  dueAt: Date | string | null;
}

export interface MyDayBuckets<T> {
  overdue: T[];
  today: T[];
  upcoming: T[];
  noDate: T[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function bucketMyDay<T extends DueItem>(items: T[], now: Date): MyDayBuckets<T> {
  const todayStart = startOfDay(now);
  // The next local midnight, which is not always 24 hours away when the clocks change.
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const out: MyDayBuckets<T> = { overdue: [], today: [], upcoming: [], noDate: [] };
  for (const item of items) {
    const t = item.dueAt === null || item.dueAt === "" ? NaN : new Date(item.dueAt).getTime();
    if (Number.isNaN(t)) out.noDate.push(item);
    else if (t < todayStart) out.overdue.push(item);
    else if (t < tomorrowStart) out.today.push(item);
    else out.upcoming.push(item);
  }
  return out;
}
