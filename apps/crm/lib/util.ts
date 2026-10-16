export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Refused because of who is asking, not what they sent. */
export class ForbiddenError extends UserError {
  constructor(message = "You don't have permission to do that") {
    super(message, 403);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL.test(v.trim());
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Trimmed text, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** Text that must be there. */
export function required(v: unknown, what: string, max = 200): string {
  const s = text(v, max);
  if (!s) throw new UserError(`${what} is required`);
  return s;
}

/** An email address, or "" when left blank. */
export function optionalEmail(v: unknown): string {
  const s = text(v, 254).toLowerCase();
  if (s && !EMAIL.test(s)) throw new UserError(`"${s.slice(0, 60)}" is not an email address`);
  return s;
}

/** A web address, given https:// when the scheme was left off; only http(s). */
export function optionalUrl(v: unknown): string {
  let s = text(v, 500);
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new UserError("Enter a web address like https://example.com");
  }
}

export function oneOf<T extends string>(v: unknown, choices: readonly T[], fallback: T, what = "value"): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (!choices.includes(v as T)) throw new UserError(`Unknown ${what}`);
  return v as T;
}

/** Money as text with up to two decimals (numeric(14,2)); null when blank. */
export function money(v: unknown): string | null {
  const s = text(v, 40).replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw new UserError("Enter an amount like 12000 or 12000.50");
  return s;
}

/** A real calendar date as YYYY-MM-DD; null when blank. */
export function isoDate(v: unknown, what = "date"): string | null {
  const s = text(v, 10);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new UserError(`Enter a valid ${what}`);
  return s;
}

/** A moment in time from an ISO string; null when blank. */
export function timestamp(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UserError("Enter a valid due date");
  return d.toISOString();
}

/** A whole percentage 0-100; null when blank. */
export function percent(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new UserError("Probability must be a whole number from 0 to 100");
  return n;
}

/** Escapes LIKE wildcards so a search for "100%" means the characters. */
export function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
