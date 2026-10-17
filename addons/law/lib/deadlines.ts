/**
 * Court deadline arithmetic in the style of Federal Rule of Civil Procedure 6(a): leave out the
 * day of the event, count every day (or only court days), and when the last day is a weekend or a
 * legal holiday, run to the next day that is neither. Service by mail adds three days first
 * (Rule 6(d)). Holidays are the federal ones; a firm adds its court's own in LAW_COURT_HOLIDAYS.
 *
 * The presets are common federal periods. Local rules, court orders and state rules change them,
 * so each result says what it was counted from and a lawyer confirms it.
 */

export type Preset = { id: string; label: string; days: number; count: "calendar" | "court"; basis: string };

export const PRESETS: Preset[] = [
  { id: "answer", label: "Answer a complaint (after service)", days: 21, count: "calendar", basis: "FRCP 12(a)(1)(A)(i)" },
  { id: "answer-waiver", label: "Answer after waiving service (from request sent)", days: 60, count: "calendar", basis: "FRCP 12(a)(1)(A)(ii)" },
  { id: "answer-us", label: "United States answers (after service on the U.S. Attorney)", days: 60, count: "calendar", basis: "FRCP 12(a)(2)" },
  { id: "reply-counterclaim", label: "Answer a counterclaim", days: 21, count: "calendar", basis: "FRCP 12(a)(1)(B)" },
  { id: "amend-course", label: "Amend once as of course (after a 12(b) motion)", days: 21, count: "calendar", basis: "FRCP 15(a)(1)(B)" },
  { id: "interrogatories", label: "Answer interrogatories", days: 30, count: "calendar", basis: "FRCP 33(b)(2)" },
  { id: "production", label: "Respond to document requests", days: 30, count: "calendar", basis: "FRCP 34(b)(2)(A)" },
  { id: "admissions", label: "Respond to requests for admission", days: 30, count: "calendar", basis: "FRCP 36(a)(3)" },
  { id: "magistrate", label: "Object to a magistrate judge's recommendation", days: 14, count: "calendar", basis: "FRCP 72(b)(2)" },
  { id: "new-trial", label: "Move for a new trial or to alter the judgment", days: 28, count: "calendar", basis: "FRCP 59(b), 59(e)" },
  { id: "jmol", label: "Renew a motion for judgment as a matter of law", days: 28, count: "calendar", basis: "FRCP 50(b)" },
  { id: "appeal", label: "Notice of appeal (civil, after judgment)", days: 30, count: "calendar", basis: "FRAP 4(a)(1)(A)" },
  { id: "appeal-us", label: "Notice of appeal when the U.S. is a party", days: 60, count: "calendar", basis: "FRAP 4(a)(1)(B)" },
  { id: "appeal-criminal", label: "Notice of appeal (criminal defendant)", days: 14, count: "calendar", basis: "FRAP 4(b)(1)(A)" },
  { id: "removal", label: "Remove to federal court (after service)", days: 30, count: "calendar", basis: "28 U.S.C. § 1446(b)" },
  { id: "costs-objection", label: "Move to review the clerk's costs", days: 7, count: "calendar", basis: "FRCP 54(d)(1)" },
];

const DAY = 86_400_000;

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function utc(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last. */
function nth(y: number, m: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(utc(y, m, 1)).getUTCDay();
    return utc(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(utc(y, m + 1, 0)).getUTCDate();
  const last = new Date(utc(y, m, lastDay)).getUTCDay();
  return utc(y, m, lastDay - ((last - weekday + 7) % 7));
}

/** A fixed-date holiday that falls on a weekend is kept on the Friday before or Monday after. */
function observed(t: number): number {
  const d = new Date(t).getUTCDay();
  return d === 6 ? t - DAY : d === 0 ? t + DAY : t;
}

const cache = new Map<number, Set<string>>();

/** Federal legal holidays (5 U.S.C. § 6103) in a year, as observed. */
export function federalHolidays(y: number): Set<string> {
  let s = cache.get(y);
  if (s) return s;
  s = new Set(
    [
      observed(utc(y, 1, 1)),
      nth(y, 1, 1, 3), // Martin Luther King Jr. Day
      nth(y, 2, 1, 3), // Washington's Birthday
      nth(y, 5, 1, -1), // Memorial Day
      observed(utc(y, 6, 19)),
      observed(utc(y, 7, 4)),
      nth(y, 9, 1, 1), // Labor Day
      nth(y, 10, 1, 2), // Columbus Day
      observed(utc(y, 11, 11)),
      nth(y, 11, 4, 4), // Thanksgiving
      observed(utc(y, 12, 25)),
    ].map(iso),
  );
  // New Year's Day of next year observed on Dec 31 of this one.
  if (new Date(utc(y + 1, 1, 1)).getUTCDay() === 6) s.add(`${y}-12-31`);
  cache.set(y, s);
  return s;
}

export function extraHolidays(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.LAW_COURT_HOLIDAYS ?? "").split(/[\s,]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
}

export function isCourtDay(day: string, extra: Set<string> = new Set()): boolean {
  const t = Date.parse(`${day}T00:00:00Z`);
  const wd = new Date(t).getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !federalHolidays(Number(day.slice(0, 4))).has(day) && !extra.has(day);
}

export type Computed = { due: string; counted: string; rolled: boolean; explanation: string };

/**
 * The last day to act, `days` after the event on `from` (YYYY-MM-DD). Court-day counting skips
 * weekends and holidays as it goes; calendar counting only moves a last day that lands on one.
 */
export function computeDeadline(
  from: string,
  days: number,
  opts: { count?: "calendar" | "court"; mail?: boolean; extra?: Set<string> } = {},
): Computed {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) throw new Error("from must be YYYY-MM-DD");
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error("days must be a whole number from 0 to 3650");
  const extra = opts.extra ?? new Set<string>();
  const count = opts.count ?? "calendar";
  let t = Date.parse(`${from}T00:00:00Z`);
  if (count === "court") {
    let left = days;
    while (left > 0) {
      t += DAY;
      if (isCourtDay(iso(t), extra)) left--;
    }
  } else {
    t += days * DAY;
  }
  const parts = [`${days} ${count === "court" ? "court" : "calendar"} days after ${from}`];
  if (opts.mail) {
    t += 3 * DAY;
    parts.push("plus 3 days for service by mail");
  }
  const counted = iso(t);
  while (!isCourtDay(iso(t), extra)) t += DAY;
  const due = iso(t);
  const rolled = due !== counted;
  if (rolled) parts.push(`${counted} is a weekend or holiday, so it runs to ${due}`);
  return { due, counted, rolled, explanation: `${parts.join(", ")}.` };
}
