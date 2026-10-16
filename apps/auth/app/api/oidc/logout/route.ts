import { NextRequest } from 'next/server';
import { redirect } from '@/lib/http';
import { sidFromRequest, getSession, revokeSession, clearCookie } from '@/lib/session';
import { verifyJwt } from '@/lib/keys';
import { findClient } from '@/lib/oauth';
import { audit } from '@/lib/audit';

/* RP-initiated logout (OIDC session management). Ends the SSO session and,
 * if post_logout_redirect_uri is registered for the id_token_hint's client,
 * redirects back to the RP. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sid = sidFromRequest(req);
  const session = await getSession(sid);
  if (session) {
    await revokeSession(session.sid);
    await audit('session.logout', String(session.user_id), {}, req);
  }

  let target = '/login?logged_out=1';
  const hint = p.get('id_token_hint');
  const postUri = p.get('post_logout_redirect_uri');
  if (hint && postUri) {
    const payload = await verifyJwt(hint);
    const clientId = typeof payload?.aud === 'string' ? payload.aud : null;
    const client = clientId ? await findClient(clientId) : null;
    if (client && (client.post_logout_uris ?? []).includes(postUri)) {
      const u = new URL(postUri);
      const state = p.get('state');
      if (state) u.searchParams.set('state', state);
      target = u.toString();
    }
  }
  return redirect(target, clearCookie);
}
