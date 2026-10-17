import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { UserError } from "../util";

/**
 * Secrets for migrations (a Microsoft 365 app's client secret, IMAP passwords) are stored
 * encrypted with AES-256-GCM under MIGRATION_ENCRYPTION_KEY, so a database dump alone hands out
 * nothing. They are never logged and never sent back to the browser.
 */
function key(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.MIGRATION_ENCRYPTION_KEY;
  if (!raw) {
    if (env.NODE_ENV === "production") throw new UserError("Set MIGRATION_ENCRYPTION_KEY (openssl rand -base64 32) to connect a source", 409);
    return createHash("sha256").update("synergy-admin-migration-dev-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function keyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.MIGRATION_ENCRYPTION_KEY || env.NODE_ENV !== "production";
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("unknown secret format");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new UserError("A stored secret can't be read: MIGRATION_ENCRYPTION_KEY changed. Enter the secret again.", 409);
  }
}
