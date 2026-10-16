import { createHash, randomBytes } from "node:crypto";

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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(v: unknown, what = "item"): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new UserError(`No such ${what}`, 404);
  return s.toLowerCase();
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** A random secret, URL-safe. */
export function secret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
