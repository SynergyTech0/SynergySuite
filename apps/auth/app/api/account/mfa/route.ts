import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { generateSecret, verifyTotp, otpauthUrl, generateBackupCodes, hashBackupCode } from '@/lib/totp';
import { q, now } from '@/lib/db';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import QRCode from 'qrcode';
import { isDemoUser } from '@/lib/config';

const DEMO_REFUSAL = "Two-step verification can't be set up on the shared demo account.";

/* POST {action:"enroll"}                -> pending secret + QR data URL
 * POST {action:"verify", code}          -> activates MFA, returns backup codes (shown once)
 * POST {action:"disable", code}         -> disables MFA (requires a valid current code)
 * POST {action:"backup_codes", code}    -> regenerates backup codes
 */
export async function POST(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (isDemoUser(auth.user.email)) return json({ error: 'demo_account', message: DEMO_REFUSAL }, 403);
  const { user } = auth;
  const body = await formBody(req);
  const action = body.get('action') ?? '';

  if (action === 'enroll') {
    const secret = generateSecret();
    await q(`UPDATE sa_users SET mfa_pending_secret = $2::text, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`, [
      user.id, encryptSecret(secret), now(),
    ]);
    const url = otpauthUrl(secret, user.email);
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return json({ secret, otpauth_url: url, qr_data_url: qr });
  }

  if (action === 'verify') {
    const code = (body.get('code') ?? '').trim();
    if (!user.mfa_pending_secret) return json({ error: 'no_enrollment_pending' }, 400);
    if (!verifyTotp(decryptSecret(user.mfa_pending_secret)!, code)) return json({ error: 'invalid_code' }, 400);
    const codes = generateBackupCodes();
    await q(
      `UPDATE sa_users SET mfa_enabled = 1::bigint, mfa_secret = $2::text, mfa_pending_secret = NULL,
        backup_codes = $3::jsonb, updated_ms = $4::bigint WHERE id + 0 = $1::bigint`,
      [user.id, user.mfa_pending_secret, JSON.stringify(codes.map(hashBackupCode)), now()],
    );
    await audit('mfa.enrolled', user.email, {}, req);
    return json({ ok: true, backup_codes: codes });
  }

  if (action === 'disable') {
    const code = (body.get('code') ?? '').trim();
    if (!user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret)!, code)) return json({ error: 'invalid_code' }, 400);
    await q(
      `UPDATE sa_users SET mfa_enabled = 0::bigint, mfa_secret = NULL, backup_codes = NULL, updated_ms = $2::bigint WHERE id + 0 = $1::bigint`,
      [user.id, now()],
    );
    await audit('mfa.disabled', user.email, {}, req);
    return json({ ok: true });
  }

  if (action === 'backup_codes') {
    const code = (body.get('code') ?? '').trim();
    if (!user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret)!, code)) return json({ error: 'invalid_code' }, 400);
    const codes = generateBackupCodes();
    await q(`UPDATE sa_users SET backup_codes = $2::jsonb, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`, [
      user.id, JSON.stringify(codes.map(hashBackupCode)), now(),
    ]);
    await audit('mfa.backup_codes_regenerated', user.email, {}, req);
    return json({ ok: true, backup_codes: codes });
  }

  return json({ error: 'unknown_action' }, 400);
}
