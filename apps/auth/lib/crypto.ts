import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ENCRYPTION_KEY } from './config';

/*
 * Secrets at rest — AES-256-GCM. Encrypts values that must be stored recoverably
 * (they cannot be hashed): TOTP shared secrets and the OIDC/SAML signing private
 * keys. Format: "enc:v1:" + base64url(iv[12] || tag[16] || ciphertext).
 *
 * decryptSecret() passes through any value WITHOUT the enc: prefix unchanged, so
 * rows written before encryption was enabled keep working (lazy migration on next
 * write). Password hashes (bcrypt), backup codes (sha256) and tokens (sha256) are
 * one-way and are NOT handled here.
 */

const PREFIX = 'enc:v1:';

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64url');
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext — pass through
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export const isEncrypted = (v: string | null | undefined): boolean => !!v && v.startsWith(PREFIX);
