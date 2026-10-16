import * as crypto from 'crypto';

/**
 * Symmetric encryption for sensitive fields at rest (bank/account numbers,
 * gateway secrets, EFTPS PINs). AES-256-GCM with a per-value random IV and an
 * auth tag, keyed by the 32-byte (64 hex char) ENCRYPTION_KEY from the vault.
 *
 * Output format: `v1:` + base64(iv[12] ‖ authTag[16] ‖ ciphertext).
 * decryptSecret() also accepts legacy plain-base64 values (pre-AES) so existing
 * rows keep working until they're next written.
 */
const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'v1:';

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('ENCRYPTION_KEY must be set to 64 hex characters (32 bytes)');
  }
  return Buffer.from(k, 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(enc: string): string {
  if (!enc) return enc;
  if (enc.startsWith(PREFIX)) {
    const raw = Buffer.from(enc.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALG, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
  // Legacy: value was stored as plain base64 before AES was introduced.
  return Buffer.from(enc, 'base64').toString('utf8');
}
