import { redirect, formBody } from '@/lib/http';
import { q } from '@/lib/db';
import { setPassword, passwordPolicyError } from '@/lib/users';
import { sha256hex } from '@/lib/oauth';
import { audit } from '@/lib/audit';

type ResetRow = { token_hash: string; user_id: string; expires_ms: string | number; used: string | number };

export async function POST(req: Request) {
  const body = await formBody(req);
  const token = body.get('token') ?? '';
  const password = body.get('password') ?? '';

  const rows = await q<ResetRow>(`SELECT * FROM sa_reset_tokens WHERE token_hash = $1::text`, [sha256hex(token)]);
  const r = rows[0];
  if (!r || Number(r.used) !== 0 || Number(r.expires_ms) < Date.now()) {
    return redirect('/reset?error=expired');
  }
  const policyError = passwordPolicyError(password);
  if (policyError) return redirect(`/reset?token=${encodeURIComponent(token)}&error=policy`);

  await q(`UPDATE sa_reset_tokens SET used = 1::bigint WHERE token_hash = $1::text`, [r.token_hash]);
  await setPassword(r.user_id, password);
  // A reset proves control of email, not the old sessions: kill them + clear lockout.
  await q(`UPDATE sa_sessions SET revoked = 1::bigint WHERE user_id = $1::bigint`, [r.user_id]);
  await q(`UPDATE sa_users SET failed_logins = 0::bigint, locked_until_ms = 0::bigint WHERE id + 0 = $1::bigint`, [r.user_id]);
  await audit('password.reset_completed', String(r.user_id), {}, req);
  return redirect('/login?reset=1');
}
