import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { setPassword, passwordPolicyError } from '@/lib/users';
import bcrypt from 'bcryptjs';
import { audit } from '@/lib/audit';
import { isDemoUser } from '@/lib/config';

const DEMO_REFUSAL = "The shared demo account's password can't be changed.";

export async function POST(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (isDemoUser(auth.user.email)) return json({ error: 'demo_account', message: DEMO_REFUSAL }, 403);
  const body = await formBody(req);
  const current = body.get('current_password') ?? '';
  const next = body.get('new_password') ?? '';

  if (!auth.user.password_hash || !(await bcrypt.compare(current, auth.user.password_hash))) {
    return json({ error: 'current_password_wrong' }, 400);
  }
  const policyError = passwordPolicyError(next);
  if (policyError) return json({ error: 'policy', message: policyError }, 400);

  await setPassword(auth.user.id, next);
  await audit('password.changed', auth.user.email, {}, req);
  return json({ ok: true });
}
