import { NextRequest } from 'next/server';
import { redirect } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { samlIdp, findSp, spInstance, issuerFromSamlRequest } from '@/lib/saml';
import { audit } from '@/lib/audit';
import { checkDeviceAccess, blockedPage } from '@/lib/device-access';

/*
 * SAML SSO endpoint (HTTP-Redirect binding in, HTTP-POST binding out).
 * No IdP session -> hosted login first, then back here; authenticated ->
 * signed Response auto-posted to the SP's registered ACS URL.
 */
export async function GET(req: NextRequest) {
  const samlRequest = req.nextUrl.searchParams.get('SAMLRequest');
  const relayState = req.nextUrl.searchParams.get('RelayState') ?? '';
  if (!samlRequest) return new Response('Missing SAMLRequest', { status: 400 });

  const spEntityId = issuerFromSamlRequest(samlRequest);
  if (!spEntityId) return new Response('Malformed SAMLRequest', { status: 400 });
  const spRow = await findSp(spEntityId);
  if (!spRow) return new Response(`Unknown SAML SP: ${spEntityId} — register it in the admin console`, { status: 400 });

  const auth = await currentUser(req);
  if (!auth) {
    const returnTo = encodeURIComponent(req.nextUrl.pathname + '?' + req.nextUrl.searchParams.toString());
    return redirect(`/login?return_to=${returnTo}`);
  }

  const access = await checkDeviceAccess(auth.user, `saml:${spEntityId}`, req);
  if (!access.allowed) return redirect(blockedPage(req.nextUrl.pathname + '?' + req.nextUrl.searchParams.toString()));

  const idp = await samlIdp();
  const sp = spInstance(spRow);

  let requestInfo: { extract: { request: { id: string } } };
  try {
    requestInfo = await idp.parseLoginRequest(sp, 'redirect', {
      query: Object.fromEntries(req.nextUrl.searchParams.entries()),
      octetString: req.nextUrl.searchParams.toString(),
    }) as never;
  } catch (e) {
    return new Response('Could not parse SAMLRequest: ' + String(e), { status: 400 });
  }

  const { context } = await idp.createLoginResponse(
    sp,
    requestInfo as never,
    'post',
    { email: auth.user.email },
  );
  await audit('saml.sso', auth.user.email, { sp: spEntityId }, req);

  const html = `<!DOCTYPE html><html><body onload="document.forms[0].submit()">
<noscript><p>Continue to ${spRow.name}:</p></noscript>
<form method="post" action="${spRow.acs_url}">
<input type="hidden" name="SAMLResponse" value="${context}"/>
${relayState ? `<input type="hidden" name="RelayState" value="${relayState.replace(/"/g, '&quot;')}"/>` : ''}
<noscript><button type="submit">Continue</button></noscript>
</form></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
