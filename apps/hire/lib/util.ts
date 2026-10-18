export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL.test(v.trim());
}

export function cleanEmail(v: unknown, what = "an email address"): string {
  const email = String(v ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new UserError(`Enter ${what}`);
  return email;
}

/** Trimmed text, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/** An http(s) link, or "" for none. Anything else (javascript:, data:) is refused. */
export function link(v: unknown, what = "Link"): string {
  const s = text(v, 2000);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {
    // fall through
  }
  throw new UserError(`${what} must be a web address starting with https://`);
}

/** A calendar day as YYYY-MM-DD, or null for none. */
export function day(v: unknown, what = "Date"): string | null {
  const s = text(v, 20);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${what} must be a date`);
  return s;
}

/** "Senior Engineer (Remote)" → "senior-engineer-remote". */
export function slugify(v: string): string {
  return v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "job";
}

export function uuidish(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function emailList(v: string | undefined): string[] {
  return (v ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}
