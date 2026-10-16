import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Passwords for outside accounts are stored encrypted (AES-256-GCM) with MAIL_ENCRYPTION_KEY,
 * so a database dump alone does not hand out people's mailboxes.
 */
function key(): Buffer {
  const raw = process.env.MAIL_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("MAIL_ENCRYPTION_KEY must be set in production");
    return createHash("sha256").update("synergy-mail-dev-key").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1") throw new Error("unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
