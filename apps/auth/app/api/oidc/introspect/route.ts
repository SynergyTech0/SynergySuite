import { json, oauthError, formBody } from '@/lib/http';
import { authenticateClient, findRefreshToken } from '@/lib/oauth';
import { verifyJwt } from '@/lib/keys';

/* RFC 7662 introspection: accepts access tokens (JWT) and refresh tokens (opaque). */
export async function POST(req: Request) {
  const body = await formBody(req);
  const client = await authenticateClient(req, body);
  if (!client) return oauthError('invalid_client', 'Client authentication failed', 401);

  const token = body.get('token') ?? '';
  if (token.startsWith('sart_')) {
    const r = await findRefreshToken(token);
    const active = !!r && Number(r.revoked) === 0 && Number(r.rotated) === 0 && Number(r.expires_ms) > Date.now();
    return json(active
      ? { active: true, token_type: 'refresh_token', client_id: r!.client_id, sub: String(r!.user_id), scope: r!.scope, exp: Math.floor(Number(r!.expires_ms) / 1000) }
      : { active: false });
  }

  const payload = await verifyJwt(token);
  if (!payload) return json({ active: false });
  return json({
    active: true,
    token_type: 'access_token',
    sub: payload.sub,
    scope: payload.scope,
    client_id: payload.client_id,
    exp: payload.exp,
    iat: payload.iat,
    iss: payload.iss,
  });
}
