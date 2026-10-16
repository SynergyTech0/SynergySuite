import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { json, formBody } from '@/lib/http';
import {
  rpID, rpOrigin, storeChallenge, consumeChallenge, newHandle, findPasskey, updateCounter,
} from '@/lib/webauthn';
import { findById, b } from '@/lib/users';
import { createSession, cookieFor } from '@/lib/session';
import { audit } from '@/lib/audit';

/*
 * Usernameless (discoverable-credential) passkey sign-in. A successful
 * assertion proves possession + on-device verification, so the session is
 * created fully authenticated (mfa_ok=1) — same treatment as Auth0/Keycloak
 * give passkeys.
 */
export async function POST(req: Request) {
  const body = await formBody(req);
  const action = body.get('action') ?? '';

  if (action === 'options') {
    const options = await generateAuthenticationOptions({
      rpID: rpID(),
      userVerification: 'preferred',
      allowCredentials: [],
    });
    const handle = newHandle();
    await storeChallenge(handle, options.challenge, 'webauthn_login', null);
    return json({ options, handle });
  }

  if (action === 'verify') {
    const handle = body.get('handle') ?? '';
    const ch = await consumeChallenge(handle, 'webauthn_login');
    if (!ch) return json({ error: 'challenge_expired' }, 400);

    const response = JSON.parse(body.get('response') ?? '{}');
    const passkey = await findPasskey(response.id ?? '');
    if (!passkey) return json({ error: 'unknown_credential' }, 400);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: rpOrigin(),
        expectedRPID: rpID(),
        requireUserVerification: false,
        credential: {
          id: passkey.cred_id,
          publicKey: new Uint8Array(Buffer.from(passkey.public_key, 'base64')),
          counter: Number(passkey.counter),
        },
      });
    } catch (e) {
      return json({ error: 'verification_failed', message: String(e) }, 400);
    }
    if (!verification.verified) return json({ error: 'not_verified' }, 400);
    await updateCounter(passkey.cred_id, verification.authenticationInfo.newCounter);

    const user = await findById(passkey.user_id);
    if (!user || b(user.disabled)) return json({ error: 'user_invalid' }, 400);

    const sid = await createSession(user.id, true, req);
    await audit('login.passkey', user.email, { cred_id8: passkey.cred_id.slice(0, 8) }, req);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieFor(sid) });
  }

  return json({ error: 'unknown_action' }, 400);
}
