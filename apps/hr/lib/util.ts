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

/** A number from a form field, or `fallback` when blank; refuses anything else. */
export function num(v: unknown, name: string, fallback = 0, { min = -Infinity, max = Infinity } = {}): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${name} must be a number${min > -Infinity ? ` of at least ${min}` : ""}`);
  return n;
}

/** Dollars from a form field as whole cents. */
export function cents(v: unknown, name: string, fallback = 0): number {
  return Math.round(num(v, name, fallback / 100, { min: 0 }) * 100);
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
