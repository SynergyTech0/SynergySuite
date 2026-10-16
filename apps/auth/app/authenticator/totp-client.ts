/*
 * Client-side TOTP for the Synergy Authenticator. RFC 6238, HMAC-SHA1 via
 * Web Crypto — the secret never leaves the device. Interoperable with the
 * server's lib/totp.ts (same algorithm/digits/period), so codes it generates
 * are exactly the ones SynergyAuth verifies at login.
 */

export type Account = {
  id: string;
  issuer: string;
  label: string;
  secret: string; // base32
  digits: number;
  period: number;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

const HASH: Record<string, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export async function generateCode(acc: Account, atMs: number = Date.now()): Promise<string> {
  const counter = Math.floor(atMs / 1000 / acc.period);
  const key = await crypto.subtle.importKey(
    'raw', base32Decode(acc.secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: HASH[acc.algorithm] ?? 'SHA-1' }, false, ['sign'],
  );
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 2 ** 32));
  dv.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1] & 0xf;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return (bin % 10 ** acc.digits).toString().padStart(acc.digits, '0');
}

export function secondsRemaining(period: number, atMs: number = Date.now()): number {
  return period - Math.floor(atMs / 1000) % period;
}

/** Parse an otpauth://totp/… URI into an Account (throws on non-TOTP / no secret). */
export function parseOtpauth(uri: string): Omit<Account, 'id'> {
  const u = new URL(uri.trim());
  if (u.protocol !== 'otpauth:') throw new Error('Not an otpauth URI');
  if (u.host !== 'totp') throw new Error('Only TOTP is supported');
  const secret = u.searchParams.get('secret');
  if (!secret) throw new Error('Missing secret');
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const [pIssuer, pLabel] = path.includes(':') ? path.split(':') : ['', path];
  const issuer = u.searchParams.get('issuer') || pIssuer || 'Account';
  const label = (pLabel || pIssuer || '').trim() || 'account';
  const algRaw = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  return {
    issuer: issuer.trim(),
    label,
    secret: secret.replace(/\s/g, ''),
    digits: Number(u.searchParams.get('digits') || 6),
    period: Number(u.searchParams.get('period') || 30),
    algorithm: (['SHA1', 'SHA256', 'SHA512'].includes(algRaw) ? algRaw : 'SHA1') as Account['algorithm'],
  };
}

export function isValidBase32(s: string): boolean {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  return clean.length >= 8 && [...clean].every((c) => B32.includes(c));
}
