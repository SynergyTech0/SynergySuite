import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

/*
 * Central runtime config + production safety guards. Read once at module load.
 *
 * Required in production (NODE_ENV=production), fail-closed otherwise:
 *   ISSUER_URL         public https origin of this IdP
 *   SA_ENCRYPTION_KEY  32-byte key (hex or base64) for secrets-at-rest
 * Optional:
 *   SA_RP_ID           WebAuthn Relying Party ID (defaults to ISSUER_URL host)
 *   SMTP_HOST/SMTP_PORT/MAIL_FROM
 */

// Enforce production guards only when actually serving — NOT during `next build`
// (which sets NODE_ENV=production and imports every route to collect page data,
// but has no real ISSUER_URL/keys yet; those arrive as runtime env at deploy).
const enforce =
  process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build';

function fail(msg: string): never {
  throw new Error(`[SynergyAuth config] ${msg}`);
}

export const ISSUER_URL = (() => {
  const v = process.env.ISSUER_URL ?? 'http://localhost:3500';
  if (enforce) {
    if (!process.env.ISSUER_URL) fail('ISSUER_URL must be set in production');
    if (!v.startsWith('https://')) fail('ISSUER_URL must be https in production');
    if (/localhost|127\.0\.0\.1/.test(v)) fail('ISSUER_URL must not be localhost in production');
  }
  return v.replace(/\/$/, '');
})();

/** WebAuthn RP ID: the registrable domain. Passkeys are bound to it — changing
 *  it invalidates existing passkeys, so it is configured explicitly. */
export const RP_ID = process.env.SA_RP_ID ?? new URL(ISSUER_URL).hostname;
export const RP_ORIGIN = new URL(ISSUER_URL).origin;

/** 32-byte key for AES-256-GCM secrets-at-rest. In dev, persist a generated key
 *  to a gitignored file so restarts can still decrypt. In prod it must be provided. */
export const ENCRYPTION_KEY: Buffer = (() => {
  const raw = process.env.SA_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) fail('SA_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64)');
    return buf;
  }
  if (enforce) fail('SA_ENCRYPTION_KEY must be set in production');
  // dev fallback: persist so TOTP secrets stay decryptable across restarts
  const devFile = path.join(process.cwd(), '.sa-dev-key');
  if (existsSync(devFile)) return Buffer.from(readFileSync(devFile, 'utf8').trim(), 'hex');
  const key = randomBytes(32);
  writeFileSync(devFile, key.toString('hex'));
  // eslint-disable-next-line no-console
  console.warn('[SynergyAuth] SA_ENCRYPTION_KEY not set — generated a dev key at .sa-dev-key (do NOT use in production).');
  return key;
})();

/*
 * Demo mode (DEMO_MODE=1, see deploy/README.md): a public demo instance. The sign-in page shows the
 * shared demo login, that account can't change its password, set up MFA or passkeys, see or end
 * other visitors' sessions, or be locked out, and no email is sent. deploy/demo/reset.mjs creates
 * the account and puts it back every DEMO_RESET_MINUTES.
 */
export const DEMO_MODE = process.env.DEMO_MODE === '1';
export const DEMO_EMAIL = (process.env.DEMO_EMAIL || `demo@${process.env.SUITE_DOMAIN ?? 'example.com'}`).toLowerCase().trim();
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'SynergyDemo1';
export const DEMO_RESET_MINUTES = Math.max(5, Number(process.env.DEMO_RESET_MINUTES) || 60);

export function isDemoUser(email: string | null | undefined): boolean {
  return DEMO_MODE && (email ?? '').toLowerCase().trim() === DEMO_EMAIL;
}

export const SMTP_HOST = process.env.SMTP_HOST ?? '127.0.0.1';
export const SMTP_PORT = Number(process.env.SMTP_PORT ?? 8025);
export const MAIL_FROM = process.env.MAIL_FROM ?? `SynergyAuth <no-reply@${new URL(ISSUER_URL).hostname.replace(/^auth\./, '')}>`;
