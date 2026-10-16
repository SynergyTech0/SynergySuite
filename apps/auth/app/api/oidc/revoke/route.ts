import { json, oauthError, formBody } from '@/lib/http';
import { authenticateClient, findRefreshToken, revokeFamily } from '@/lib/oauth';
import { audit } from '@/lib/audit';

/* RFC 7009 revocation. Access tokens are short-lived stateless JWTs; revoking a
 * refresh token kills its whole rotation family. Always returns 200 per spec. */
export async function POST(req: Request) {
  const body = await formBody(req);
  const client = await authenticateClient(req, body);
  if (!client) return oauthError('invalid_client', 'Client authentication failed', 401);

  const token = body.get('token') ?? '';
  if (token.startsWith('sart_')) {
    const r = await findRefreshToken(token);
    if (r && r.client_id === client.client_id) {
      await revokeFamily(r.family_id);
      await audit('oidc.revoke', client.client_id, { family: r.family_id }, req);
    }
  }
  return json({});
}
