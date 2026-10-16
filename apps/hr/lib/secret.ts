import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { UserError } from "./util";

/**
 * Field encryption for the few things payroll has to keep in full: Social Security numbers (for
 * W-2s) and bank account numbers (for direct deposit files). AES-256-GCM with HR_DATA_KEY, 32 bytes
 * as 64 hex characters or base64 (`openssl rand -hex 32`). Without the key these fields can't be
 * saved, and the database alone never holds them in the clear.
 */

const VERSION = "v1";

function key(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env.HR_DATA_KEY ?? "").trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("HR_DATA_KEY must be 32 bytes: 64 hex characters or base64");
  return buf;
}

export function canEncrypt(env: NodeJS.ProcessEnv = process.env): boolean {
  return key(env) !== null;
}

function requireKey(env?: NodeJS.ProcessEnv): Buffer {
  const k = key(env);
  if (!k) throw new UserError("Set HR_DATA_KEY on the HR app to keep Social Security and bank account numbers", 409);
  return k;
}

export function seal(plain: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(env), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function open(sealed: string, env?: NodeJS.ProcessEnv): string {
  if (!sealed) return "";
  const [v, data] = sealed.split(":", 2);
  if (v !== VERSION || !data) throw new Error("Unknown sealed value");
  const raw = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(env), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
