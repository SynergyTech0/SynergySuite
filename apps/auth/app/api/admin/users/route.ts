import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q, now } from '@/lib/db';
import { createUser, findByEmail, setPassword, passwordPolicyError, type User } from '@/lib/users';
import { audit } from '@/lib/audit';
import { revokeAll } from '@/lib/app-passwords';

async function requireAdmin(req: Request) {
  const auth = await currentUser(req);
  if (!auth || auth.user.role !== 'admin') return null;
  return auth;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const rows = await q<User>(`SELECT * FROM sa_users ORDER BY id LIMIT $1`, [500]);
  return json({
    users: rows.map((u) => ({
      id: String(u.id), email: u.email, name: u.name, role: u.role,
      disabled: Number(u.disabled) !== 0, mfa_enabled: Number(u.mfa_enabled) !== 0,
      mfa_required: Number(u.mfa_required) !== 0, created_ms: Number(u.created_ms),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const body = await formBody(req);
  const action = body.get('action') ?? 'create';

  if (action === 'create') {
    const email = body.get('email') ?? '';
    const password = body.get('password') ?? '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'bad_email' }, 400);
    const policyError = passwordPolicyError(password);
    if (policyError) return json({ error: 'policy', message: policyError }, 400);
    if (await findByEmail(email)) return json({ error: 'exists' }, 409);
    const user = await createUser({
      email, name: body.get('name') ?? undefined, password,
      role: body.get('role') === 'admin' ? 'admin' : 'user',
      mfaRequired: body.get('mfa_required') === '1',
    });
    await audit('admin.user_created', auth.user.email, { email }, req);
    return json({ ok: true, id: String(user.id) });
  }

  const userId = body.get('user_id') ?? '';
  if (!userId) return json({ error: 'missing_user_id' }, 400);

  if (action === 'disable' || action === 'enable') {
    await q(
      `UPDATE sa_users SET disabled = $2::bigint, failed_logins = 0::bigint, locked_until_ms = 0::bigint, updated_ms = $3::bigint WHERE id + 0 = $1::bigint`,
      [userId, action === 'disable' ? 1 : 0, now()],
    );
    if (action === 'disable') {
      await q(`UPDATE sa_sessions SET revoked = 1::bigint WHERE user_id = $1::bigint`, [userId]);
      await q(`UPDATE sa_refresh_tokens SET revoked = 1::bigint WHERE user_id = $1::bigint`, [userId]);
    }
    await audit(`admin.user_${action}d`, auth.user.email, { user_id: userId }, req);
    return json({ ok: true });
  }

  if (action === 'reset_password') {
    const password = body.get('password') ?? '';
    const policyError = passwordPolicyError(password);
    if (policyError) return json({ error: 'policy', message: policyError }, 400);
    await setPassword(userId, password);
    await q(`UPDATE sa_users SET failed_logins = 0::bigint, locked_until_ms = 0::bigint WHERE id + 0 = $1::bigint`, [userId]);
    await q(`UPDATE sa_sessions SET revoked = 1::bigint WHERE user_id = $1::bigint`, [userId]);
    await revokeAll(userId);
    await audit('admin.password_reset', auth.user.email, { user_id: userId }, req);
    return json({ ok: true });
  }

  if (action === 'reset_mfa') {
    await q(
      `UPDATE sa_users SET mfa_enabled = 0::bigint, mfa_secret = NULL, backup_codes = NULL, updated_ms = $2::bigint WHERE id + 0 = $1::bigint`,
      [userId, now()],
    );
    await audit('admin.mfa_reset', auth.user.email, { user_id: userId }, req);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
