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

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEmail(v: unknown): boolean {
  return typeof v === "string" && v.length <= 254 && EMAIL.test(v.trim());
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
export function optionalEmail(v: unknown, what = "email address"): string {
  const s = text(v, 254).toLowerCase();
  if (s && !EMAIL.test(s)) throw new UserError(`"${s.slice(0, 60)}" is not an ${what}`);
  return s;
}

export function oneOf<T extends string>(v: unknown, choices: readonly T[], fallback: T, what = "value"): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (!choices.includes(v as T)) throw new UserError(`Unknown ${what}`);
  return v as T;
}

/** A moment in time from an ISO string; null when blank. */
export function timestamp(v: unknown, what = "time"): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UserError(`Enter a valid ${what}`);
  return d.toISOString();
}

/** Tags: trimmed, lower-cased, unique, at most 50 of up to 40 characters. */
export function tags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(list.map((t) => text(t, 40).toLowerCase()).filter(Boolean))].slice(0, 50);
}

/** Escapes LIKE wildcards so a search for "100%" means the characters. */
export function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A random token for links in emails: 128 bits, URL-safe. */
export function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
