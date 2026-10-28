import { redirect, formBody } from '@/lib/http';
import { pendingMfaSession, completeMfa, cookieFor } from '@/lib/session';
import { verifyTotp, consumeBackupCode } from '@/lib/totp';
import { q } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { audit } from '@/lib/audit';

function safeReturnTo(v: string | null): string {
  if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  return '/account';
}

export async function POST(req: Request) {
  const body = await formBody(req);
  const code = (body.get('code') ?? '').trim();
  const returnTo = safeReturnTo(body.get('return_to'));
  const enc = encodeURIComponent(returnTo);

  const pending = await pendingMfaSession(req);
  if (!pending) return redirect(`/login?return_to=${enc}`);
  const { user, session } = pending;

  let ok = false;
  if (/^\d{6}$/.test(code) && user.mfa_secret) {
    ok = verifyTotp(decryptSecret(user.mfa_secret)!, code);
  } else if (user.backup_codes && Array.isArray(user.backup_codes)) {
    const remaining = consumeBackupCode(code, user.backup_codes);
    if (remaining) {
      ok = true;
      await q(`UPDATE sa_users SET backup_codes = $2::jsonb WHERE id + 0 = $1::bigint`, [user.id, JSON.stringify(remaining)]);
      await audit('mfa.backup_code_used', user.email, { remaining: remaining.length }, req);
    }
  }

  if (!ok) {
    await audit('mfa.fail', user.email, {}, req);
    return redirect(`/login/mfa?error=1&return_to=${enc}`);
  }
  const sid = await completeMfa(session.sid, user.id, req);
  if (!sid) return redirect(`/login?return_to=${enc}`);
  await audit('mfa.ok', user.email, { method: 'code' }, req);
  return redirect(returnTo, cookieFor(sid));
}
