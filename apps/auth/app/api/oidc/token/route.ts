import { json, oauthError, formBody } from '@/lib/http';
import {
  authenticateClient, consumeCode, verifyPkce, mintTokens, rotateRefreshToken,
} from '@/lib/oauth';
import { findById, b } from '@/lib/users';
import { audit } from '@/lib/audit';
import { checkDeviceAccess } from '@/lib/device-access';

export async function POST(req: Request) {
  const body = await formBody(req);
  const grant = body.get('grant_type') ?? '';

  const client = await authenticateClient(req, body);
  if (!client) return oauthError('invalid_client', 'Client authentication failed', 401);
  const grants = client.grant_types ?? [];

  if (grant === 'authorization_code') {
    if (!grants.includes('authorization_code')) return oauthError('unauthorized_client', 'Grant not allowed');
    const code = body.get('code') ?? '';
    const row = await consumeCode(code);
    if (!row || row.client_id !== client.client_id) return oauthError('invalid_grant', 'Code is invalid, expired, or already used');
    if (row.redirect_uri !== (body.get('redirect_uri') ?? '')) return oauthError('invalid_grant', 'redirect_uri mismatch');
    if (!verifyPkce(row, body.get('code_verifier'))) return oauthError('invalid_grant', 'PKCE verification failed');

    const user = await findById(row.user_id);
    if (!user || b(user.disabled)) return oauthError('invalid_grant', 'User no longer valid');

    const tokens = await mintTokens({
      user, client, scope: row.scope, nonce: row.nonce, sessionSid: row.session_sid,
      includeRefresh: grants.includes('refresh_token'),
    });
    await audit('oidc.token.code', user.email, { client_id: client.client_id }, req);
    return json(tokens);
  }

  if (grant === 'refresh_token') {
    if (!grants.includes('refresh_token')) return oauthError('unauthorized_client', 'Grant not allowed');
    const rt = body.get('refresh_token') ?? '';
    const result = await rotateRefreshToken(rt, client.client_id);
    if (!result.ok) {
      if (result.error === 'reused') {
        await audit('oidc.refresh.reuse_detected', client.client_id, {}, req);
        return oauthError('invalid_grant', 'Refresh token reuse detected; token family revoked', 400);
      }
      return oauthError('invalid_grant', 'Refresh token is invalid or expired');
    }
    const user = await findById(result.row.user_id);
    if (!user || b(user.disabled)) return oauthError('invalid_grant', 'User no longer valid');
    // A device that fell out of policy ends the session at its next renewal; signing in again
    // lands on the blocked page.
    if (!(await checkDeviceAccess(user, `oidc:${client.client_id}`, req)).allowed) {
      return oauthError('invalid_grant', 'A device of yours does not meet your organization\'s policies');
    }
    const tokens = await mintTokens({
      user, client, scope: result.row.scope, sessionSid: result.row.session_sid, includeRefresh: false,
    });
    tokens.refresh_token = result.newToken;
    await audit('oidc.token.refresh', user.email, { client_id: client.client_id }, req);
    return json(tokens);
  }

  if (grant === 'client_credentials') {
    if (!grants.includes('client_credentials')) return oauthError('unauthorized_client', 'Grant not allowed');
    if (b(client.public_client)) return oauthError('unauthorized_client', 'Public clients cannot use client_credentials');
    const scope = body.get('scope') ?? '';
    const tokens = await mintTokens({ user: null, client, scope, includeRefresh: false });
    await audit('oidc.token.client_credentials', client.client_id, {}, req);
    return json(tokens);
  }

  return oauthError('unsupported_grant_type', `Unsupported grant_type "${grant}"`);
}
