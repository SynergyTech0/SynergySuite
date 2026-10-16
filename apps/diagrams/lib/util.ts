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
