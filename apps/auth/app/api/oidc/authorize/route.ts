import { NextRequest } from 'next/server';
import { redirect, oauthError } from '@/lib/http';
import { findClient, issueCode, hasGrant } from '@/lib/oauth';
import { currentUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { b } from '@/lib/users';
import { checkDeviceAccess, blockedPage } from '@/lib/device-access';

/*
 * OIDC authorization endpoint (code flow only, Keycloak-style hosted login).
 *  - no SSO session          -> 303 to /login?return_to=<this url>
 *  - session, MFA pending    -> /login/mfa
 *  - third-party, no grant   -> /consent
 *  - a device out of policy  -> /login/device-blocked (lib/device-access.ts)
 *  - else                    -> 303 back to client with ?code=&state=
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  const state = p.get('state');
  const nonce = p.get('nonce');
  const scope = (p.get('scope') ?? 'openid').trim();
  const responseType = p.get('response_type') ?? '';
  const codeChallenge = p.get('code_challenge');
  const challengeMethod = p.get('code_challenge_method') ?? (codeChallenge ? 'S256' : null);
  const prompt = p.get('prompt');

  const client = await findClient(clientId);
  if (!client) return oauthError('invalid_client', 'Unknown client_id');
  const uris = client.redirect_uris ?? [];
  if (!uris.includes(redirectUri)) return oauthError('invalid_request', 'redirect_uri is not registered for this client');

  // From here on, errors go back to the client per RFC 6749 §4.1.2.1
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (state) u.searchParams.set('state', state);
    return redirect(u.toString());
  };

  if (responseType !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported');
  const allowed = new Set(client.scopes ?? []);
  for (const s of scope.split(' ')) {
    if (!allowed.has(s)) return back('invalid_scope', `Scope "${s}" not allowed for this client`);
  }
  if (b(client.public_client) && !codeChallenge) {
    return back('invalid_request', 'PKCE (code_challenge) is required for public clients');
  }
  if (challengeMethod && !['S256', 'plain'].includes(challengeMethod)) {
    return back('invalid_request', 'Unsupported code_challenge_method');
  }

  const auth = await currentUser(req);
  const returnTo = encodeURIComponent(req.nextUrl.pathname + '?' + p.toString());
  if (!auth || prompt === 'login') {
    return redirect(`/login?return_to=${returnTo}`);
  }

  if (!b(client.first_party) && !(await hasGrant(auth.user.id, clientId, scope))) {
    return redirect(`/consent?return_to=${returnTo}`);
  }

  const access = await checkDeviceAccess(auth.user, `oidc:${clientId}`, req);
  if (!access.allowed) return redirect(blockedPage(req.nextUrl.pathname + '?' + p.toString()));

  const code = await issueCode({
    clientId, userId: auth.user.id, redirectUri, scope, nonce,
    codeChallenge, challengeMethod: codeChallenge ? challengeMethod : null,
    sessionSid: auth.session.sid,
  });
  await audit('oidc.authorize', auth.user.email, { client_id: clientId, scope }, req);

  const u = new URL(redirectUri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return redirect(u.toString());
}
