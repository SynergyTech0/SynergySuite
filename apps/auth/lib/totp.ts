import { createHmac, randomBytes, createHash } from 'crypto';

/*
 * TOTP engine ported from SynergyEMR's MFAService (RFC 6238, SHA1/6-digit/30s,
 * +-1 window) — dependency-free, interoperable with Google Authenticator etc.
 */

const DIGITS = 6;
const PERIOD = 30;
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(length = 32): string {
  const bytes = randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) secret += BASE32[bytes[i] % 32];
  return secret;
}

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const ch of secret.toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  return out;
}

export function totpCode(secret: string, atSeconds?: number): string {
  const time = atSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / PERIOD);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  const hash = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = hash[hash.length - 1] & 0xf;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function verifyTotp(secret: string, code: string): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  for (let i = -WINDOW; i <= WINDOW; i++) {
    if (totpCode(secret, nowSec + i * PERIOD) === code) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, email: string, issuer = 'SynergyAuth'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const c = randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    codes.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.replace('-', '').toLowerCase()).digest('hex');
}

/** Returns remaining hashes if valid, null if not. */
export function consumeBackupCode(code: string, hashes: string[]): string[] | null {
  const h = hashBackupCode(code);
  const idx = hashes.indexOf(h);
  if (idx === -1) return null;
  return [...hashes.slice(0, idx), ...hashes.slice(idx + 1)];
}
