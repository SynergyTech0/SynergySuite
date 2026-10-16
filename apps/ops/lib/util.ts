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

/** Required text: a clear message when it is missing. */
export function need(v: unknown, label: string, max = 200): string {
  const t = text(v, max);
  if (!t) throw new UserError(`Enter ${label}`);
  return t;
}

/** An email, or "" when blank. Anything else that isn't an email is refused. */
export function optEmail(v: unknown, label = "an email address"): string {
  const e = text(v, 320).toLowerCase();
  if (e && !EMAIL.test(e)) throw new UserError(`Enter ${label}`);
  return e;
}

/** A number within bounds; blank gives `fallback` (or an error when there is none). */
export function number(v: unknown, label: string, opts: { min?: number; max?: number; fallback?: number; above?: number } = {}): number {
  if (v === undefined || v === null || v === "") {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new UserError(`Enter ${label}`);
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) throw new UserError(`${cap(label)} must be a number`);
  if (opts.above !== undefined && n <= opts.above) throw new UserError(`${cap(label)} must be more than ${opts.above}`);
  if (opts.min !== undefined && n < opts.min) throw new UserError(`${cap(label)} can't be less than ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new UserError(`${cap(label)} can't be more than ${opts.max}`);
  return n;
}

export function optNumber(v: unknown, label: string, opts: { min?: number; max?: number; above?: number } = {}): number | null {
  if (v === undefined || v === null || v === "") return null;
  return number(v, label, opts);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A yyyy-mm-dd date, or null when blank. */
export function optDate(v: unknown, label: string): string | null {
  const t = text(v, 10);
  if (!t) return null;
  if (!DAY.test(t) || Number.isNaN(new Date(`${t}T00:00:00Z`).getTime())) throw new UserError(`${cap(label)} must be a date`);
  return t;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
  if (!allowed.includes(v as T)) throw new UserError(`Pick a ${label}`);
  return v as T;
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Today as yyyy-mm-dd (UTC). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A Postgres DATE value as yyyy-mm-dd, whatever the driver handed back. */
export function day(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // pg builds DATE values at local midnight.
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

/** Quantities and money rounded for storage and display. */
export const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;
