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

/** A UUID from the address, or a 404. */
export function uuid(v: unknown, what = "That"): string {
  if (!isUuid(v)) throw new UserError(`${what} was not found`, 404);
  return v.toLowerCase();
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

export function cleanEmail(v: unknown): string {
  const email = text(v, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("Enter an email address");
  return email;
}

/** A list of email addresses from an array or a comma/space separated string: lower-cased, unique. */
export function emailList(v: unknown, max = 500): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/);
  const out = new Set<string>();
  for (const item of raw) {
    const e = text(item, 254).toLowerCase();
    if (!e) continue;
    if (!EMAIL.test(e)) throw new UserError(`"${e.slice(0, 60)}" is not an email address`);
    out.add(e);
  }
  if (out.size > max) throw new UserError(`At most ${max} people`);
  return [...out].sort();
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

export function oneOf<T extends string>(v: unknown, choices: readonly T[], fallback: T, what = "value"): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (!choices.includes(v as T)) throw new UserError(`Unknown ${what}`);
  return v as T;
}

/** Escapes LIKE wildcards so a search for "100%" means the characters. */
export function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
