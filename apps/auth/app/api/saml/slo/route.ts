import { NextRequest } from 'next/server';
import { redirect } from '@/lib/http';
import { sidFromRequest, getSession, revokeSession, clearCookie } from '@/lib/session';
import { samlIdp, findSp, spInstance, issuerFromSamlRequest } from '@/lib/saml';
import { audit } from '@/lib/audit';

/*
 * SAML Single Logout (SP-initiated, HTTP-Redirect binding). The SP sends a
 * LogoutRequest; we end the IdP SSO session and, if the SP declared a
 * SingleLogoutService URL, return a signed LogoutResponse there. Without a
 * SAMLRequest this acts as a plain "end my SSO session" and shows confirmation.
 */
export async function GET(req: NextRequest) {
  const sid = sidFromRequest(req);
  const session = await getSession(sid);
  if (session) {
    await revokeSession(session.sid);
    await audit('saml.slo', String(session.user_id), {}, req);
  }

  const samlRequest = req.nextUrl.searchParams.get('SAMLRequest');
  if (!samlRequest) {
    return redirect('/login?logged_out=1', clearCookie);
  }

  const spEntityId = issuerFromSamlRequest(samlRequest);
  const spRow = spEntityId ? await findSp(spEntityId) : null;
  if (!spRow || !spRow.slo_url) {
    // Nowhere to send the response — session is already ended locally.
    return redirect('/login?logged_out=1', clearCookie);
  }

  const relayState = req.nextUrl.searchParams.get('RelayState') ?? '';
  try {
    const idp = await samlIdp();
    const sp = spInstance(spRow);
    const requestInfo = await idp.parseLogoutRequest(sp, 'redirect', {
      query: Object.fromEntries(req.nextUrl.searchParams.entries()),
      octetString: req.nextUrl.searchParams.toString(),
    });
    const { context } = await idp.createLogoutResponse(sp, requestInfo as never, 'redirect', relayState);
    const location = context.startsWith('http') ? context : `${spRow.slo_url}?${context}`;
    return redirect(location, clearCookie);
  } catch {
    // Couldn't build a signed SAML LogoutResponse — the SSO session is already
    // ended, so degrade to a local logout confirmation (valid SLO outcome).
    return redirect('/login?logged_out=1', clearCookie);
  }
}
