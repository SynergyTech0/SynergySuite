import { json, formBody, sameOrigin } from '@/lib/http';
import { pendingMfaSession, cookieFor } from '@/lib/session';
import { startPush, checkPush } from '@/lib/push-mfa';

function safeReturnTo(v: string | null): string {
  if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  return '/account';
}

/*
 * The MFA page's "Approve on your phone". action=start sends the approval (or answers with the
 * one already out for this session), action=check asks how it went. Nothing the browser sends
 * names an approval: the session cookie picks it, and only the Pager can say it was approved.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const body = await formBody(req);
  const pending = await pendingMfaSession(req);
  if (!pending) return json({ error: 'no_pending_sign_in' }, 401);
  const { user, session } = pending;
  const action = body.get('action') ?? '';

  if (action === 'start') {
    const r = await startPush(req, user, session);
    if (r.ok) return json({ number: r.number, expires_in: r.expires_in });
    const status = r.error === 'rate_limited' ? 429 : r.error === 'not_enabled' ? 404 : 503;
    return json({ error: r.error }, status);
  }

  if (action === 'check') {
    const r = await checkPush(req, user, session, Number(body.get('wait') ?? 0));
    if (r.status === 'approved') {
      return json({ status: 'approved', redirect: safeReturnTo(body.get('return_to')) }, 200, { 'Set-Cookie': cookieFor(r.sid) });
    }
    return json({ status: r.status });
  }

  return json({ error: 'unknown_action' }, 400);
}
