export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Base64 (standard or URL-safe) as the browser sends ciphertext, IVs and salts. */
export function isBlob(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length < 200_000 && /^[A-Za-z0-9+/=_-]+$/.test(v);
}

export function blob(v: unknown, what = "Encrypted data"): string {
  if (!isBlob(v)) throw new UserError(`${what} is missing or not base64`);
  return v;
}
