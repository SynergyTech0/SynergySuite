/**
 * Time zone arithmetic and slot finding, with no dependencies: a booking page keeps its hours in
 * its own time zone, while every stored time is UTC.
 */

/** Minutes from midnight, [start, end) for one opening window. */
export type Window = [number, number];
/** Opening hours by weekday, Sunday first: seven lists of windows. */
export type WeekHours = Window[][];
export type Interval = { start: number; end: number };

export const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of `ts` in `tz`. */
export function parts(ts: number, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(new Date(ts))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** How far `tz` is ahead of UTC at `ts`, in milliseconds. */
export function offsetMs(ts: number, tz: string): number {
  const p = parts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ts / 1000) * 1000;
}

/** The UTC instant for `minutes` past midnight on `day` (YYYY-MM-DD) in `tz`. */
export function zonedTime(day: string, minutes: number, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let ts = wall - offsetMs(wall, tz);
  // A second pass settles days where the offset changes (daylight saving).
  const again = wall - offsetMs(ts, tz);
  if (again !== ts) ts = again;
  return ts;
}

/** The calendar day of `ts` in `tz`, as YYYY-MM-DD. */
export function dayIn(ts: number, tz: string): string {
  const p = parts(ts, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday to Friday, 9 to 5. */
export function defaultHours(): WeekHours {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0 || d === 6 ? [] : [[540, 1020] as Window]));
}

/** Checks and tidies opening hours: sorted, non-overlapping windows inside the day. */
export function cleanHours(v: unknown): WeekHours | null {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const out: WeekHours = [];
  for (const day of v) {
    if (!Array.isArray(day) || day.length > 6) return null;
    const ws: Window[] = [];
    for (const w of day) {
      if (!Array.isArray(w) || w.length !== 2) return null;
      const [s, e] = w.map(Number);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || s >= e) return null;
      ws.push([s, e]);
    }
    ws.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ws.length; i++) if (ws[i][0] < ws[i - 1][1]) return null;
    out.push(ws);
  }
  return out;
}

export type SlotRules = {
  tz: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** Start times fall on this grid within each window. */
  stepMin: number;
  /** Earliest start: now + this. */
  minNoticeMin: number;
  /** Latest start: now + this many days. */
  maxDaysAhead: number;
};

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Free start times (UTC ms) for one person between two days (inclusive, in the page's time zone):
 * inside their hours, far enough ahead, and with the appointment plus its buffers clear of `busy`.
 */
export function freeStarts(hours: WeekHours, busy: Interval[], rules: SlotRules, fromDay: string, toDay: string, now: number): number[] {
  const earliest = now + rules.minNoticeMin * MIN_MS;
  const latest = now + rules.maxDaysAhead * DAY_MS;
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const out: number[] = [];
  const step = Math.max(5, rules.stepMin);
  for (let day = fromDay, n = 0; day <= toDay && n < 400; day = addDays(day, 1), n++) {
    for (const [ws, we] of hours[weekday(day)] ?? []) {
      for (let t = ws; t + rules.durationMin <= we; t += step) {
        const start = zonedTime(day, t, rules.tz);
        // A wall time skipped by daylight saving lands elsewhere; leave it out.
        if (dayIn(start, rules.tz) !== day || start < earliest || start > latest) continue;
        const block = { start: start - rules.bufferBeforeMin * MIN_MS, end: start + (rules.durationMin + rules.bufferAfterMin) * MIN_MS };
        if (!sorted.some((b) => overlaps(b, block))) out.push(start);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
