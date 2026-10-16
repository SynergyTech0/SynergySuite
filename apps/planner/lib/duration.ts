/**
 * Jira-style durations, stored as minutes. "1d 4h 30m" is 750 because a working day is 8h and a
 * working week 5d, which are Jira's defaults — not calendar days, so an estimate means working time.
 */
const MINUTES: Record<string, number> = { m: 1, h: 60, d: 480, w: 2400 };
const UNIT = /(\d+(?:\.\d+)?)\s*([wdhm])/gi;

export function parseDuration(input: string): number | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);              // a bare number is minutes
  // Every character must belong to a unit group, so "3 fortnights" or "1.5x" is rejected rather than
  // partially understood.
  if (!/^(\d+(\.\d+)?\s*[wdhm]\s*)+$/.test(s)) return null;
  let total = 0;
  for (const m of s.matchAll(UNIT)) total += Number(m[1]) * MINUTES[m[2]];
  const rounded = Math.round(total);
  return rounded >= 0 ? rounded : null;
}

export function formatDuration(minutes: number): string {
  if (!minutes) return "0m";
  const parts: string[] = [];
  let left = Math.max(0, Math.round(minutes));
  for (const unit of ["w", "d", "h", "m"] as const) {
    const size = MINUTES[unit];
    const n = Math.floor(left / size);
    if (n) { parts.push(`${n}${unit}`); left -= n * size; }
  }
  return parts.join(" ");
}
