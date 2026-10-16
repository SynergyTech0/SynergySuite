export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL.test(v.trim());
}

export function cleanEmail(v: unknown): string {
  const email = String(v ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("Enter an email address");
  return email;
}

/** Trimmed text, cut to `max` characters. */
export function text(v: unknown, max = 500): string {
  return String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

/**
 * Money typed by a person ("1,250.50", "$80", 80) as whole cents. Empty is null. Refuses
 * negatives and anything that isn't a number.
 */
export function cents(v: unknown, what = "Amount"): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) throw new UserError(`${what} must be a positive number`);
    return Math.round(v * 100);
  }
  const s = String(v).replace(/[\s,$€£]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) throw new UserError(`${what} must be a number like 125.50`);
  return Math.round(Number(s) * 100);
}

/**
 * A duration typed by a person as minutes: "1.5", "1:30", "90m", "1h 30m", or a number of hours.
 * Empty or zero is 0.
 */
export function minutes(v: unknown, what = "Hours"): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) throw new UserError(`${what} must be a positive number`);
    return Math.round(v * 60);
  }
  const s = String(v).trim().toLowerCase();
  if (!s) return 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,3}):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 60);
  if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/)) && (m[1] || m[2])) {
    return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  }
  throw new UserError(`${what} must look like 1.5, 1:30 or 1h 30m`);
}

/** "1.5" for 90 minutes; "" for none. */
export function hoursText(min: number | null | undefined): string {
  if (!min) return "";
  return String(Math.round((min / 60) * 100) / 100);
}

export function uuidish(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
