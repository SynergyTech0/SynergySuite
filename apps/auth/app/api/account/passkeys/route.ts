import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q } from '@/lib/db';
import {
  rpID, rpOrigin, storeChallenge, consumeChallenge, passkeysForUser, savePasskey,
} from '@/lib/webauthn';
import { audit } from '@/lib/audit';
import { isDemoUser } from '@/lib/config';

export async function GET(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const keys = await passkeysForUser(auth.user.id);
  return json({
    passkeys: keys.map((k) => ({
      cred_id8: k.cred_id.slice(0, 8), name: k.name, created_ms: Number(k.created_ms),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const { user, session } = auth;
  const body = await formBody(req);
  const action = body.get('action') ?? '';

  if (isDemoUser(user.email) && action.startsWith('register')) {
    return json({ error: 'demo_account', message: "Passkeys can't be added to the shared demo account." }, 403);
  }

  if (action === 'register_options') {
    const existing = await passkeysForUser(user.id);
    const options = await generateRegistrationOptions({
      rpName: 'SynergyAuth',
      rpID: rpID(),
      userID: Buffer.from(String(user.id)),
      userName: user.email,
      userDisplayName: user.name ?? user.email,
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.cred_id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await storeChallenge(session.sid, options.challenge, 'webauthn_register', user.id);
    return json({ options });
  }

  if (action === 'register_verify') {
    const ch = await consumeChallenge(session.sid, 'webauthn_register');
    if (!ch) return json({ error: 'challenge_expired' }, 400);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: JSON.parse(body.get('response') ?? '{}'),
        expectedChallenge: ch.challenge,
        expectedOrigin: rpOrigin(),
        expectedRPID: rpID(),
        requireUserVerification: false,
      });
    } catch (e) {
      return json({ error: 'verification_failed', message: String(e) }, 400);
    }
    if (!verification.verified || !verification.registrationInfo) return json({ error: 'not_verified' }, 400);
    const { credential } = verification.registrationInfo;
    await savePasskey({
      credId: credential.id,
      userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: body.get('name') || 'Passkey',
    });
    await audit('passkey.registered', user.email, { cred_id8: credential.id.slice(0, 8) }, req);
    return json({ ok: true });
  }

  if (action === 'delete') {
    const prefix = body.get('cred_id8') ?? '';
    const keys = await passkeysForUser(user.id);
    for (const k of keys) {
      if (k.cred_id.startsWith(prefix)) {
        await q(`DELETE FROM sa_passkeys WHERE cred_id = $1::text`, [k.cred_id]);
        await audit('passkey.deleted', user.email, { cred_id8: prefix }, req);
      }
    }
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
