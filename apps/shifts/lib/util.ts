export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed text, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** An email address, or "" for none. */
export function optionalEmail(v: unknown): string {
  const email = String(v ?? "").trim().toLowerCase();
  if (email && !EMAIL.test(email)) throw new UserError("That isn't an email address");
  return email;
}

/** A positive whole-number id, or null for none. Anything else is "not found". */
export function optionalId(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new UserError("Not found", 404);
  return n;
}

export function id(v: unknown): number {
  const n = optionalId(v);
  if (n === null) throw new UserError("Not found", 404);
  return n;
}

/** A "#rrggbb" colour, or the default. */
export function color(v: unknown, fallback = "#4f46e5"): string {
  const s = String(v ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : fallback;
}

/** A calendar day as YYYY-MM-DD, checked to be a real date. */
export function day(v: unknown, what = "Date"): string {
  const s = String(v ?? "").slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new UserError(`${what} must be a date`);
  return s;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week `dayStr` falls in. */
export function weekStart(dayStr: string): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  return addDays(dayStr, -((d.getUTCDay() + 6) % 7));
}

/** A time of day as minutes after midnight: "09:30", "9:30", or a number of minutes. 24:00 is the end of the day. */
export function minutes(v: unknown, what = "Time"): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440) return v;
  const m = String(v ?? "").trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) {
    const total = Number(m[1]) * 60 + Number(m[2]);
    if (total <= 1440) return total;
  }
  throw new UserError(`${what} must be a time like 09:30`);
}
