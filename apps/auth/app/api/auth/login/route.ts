import { redirect, formBody } from '@/lib/http';
import { checkLogin, b } from '@/lib/users';
import { createSession, cookieFor } from '@/lib/session';
import { audit } from '@/lib/audit';
import { pushEnabledFor } from '@/lib/push-mfa';

function safeReturnTo(v: string | null): string {
  // Only allow same-site relative paths to prevent open redirects
  if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  return '/account';
}

export async function POST(req: Request) {
  const body = await formBody(req);
  const email = body.get('email') ?? '';
  const password = body.get('password') ?? '';
  const returnTo = safeReturnTo(body.get('return_to'));
  const enc = encodeURIComponent(returnTo);

  const result = await checkLogin(email, password);
  if (!result.ok) {
    await audit(`login.fail`, email, { reason: result.reason }, req);
    const msg = result.reason === 'locked' ? 'locked' : result.reason === 'disabled' ? 'disabled' : 'invalid';
    return redirect(`/login?error=${msg}&return_to=${enc}`);
  }

  // Someone set up for phone approval always gets the second step, enrolled in codes or not.
  const needsMfa = b(result.user.mfa_enabled) || pushEnabledFor(result.user.email);
  const sid = await createSession(result.user.id, !needsMfa, req);
  await audit('login.password_ok', result.user.email, { mfa_pending: needsMfa }, req);

  const target = needsMfa ? `/login/mfa?return_to=${enc}` : returnTo;
  return redirect(target, cookieFor(sid));
}
