import { json, oauthError } from '@/lib/http';
import { verifyJwt } from '@/lib/keys';
import { findById, b } from '@/lib/users';
import { userClaims } from '@/lib/oauth';

async function handle(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return oauthError('invalid_token', 'Missing Bearer token', 401);
  }
  const payload = await verifyJwt(auth.slice(7));
  if (!payload || typeof payload.sub !== 'string' || payload.gty === 'client_credentials') {
    return oauthError('invalid_token', 'Token is invalid or expired', 401);
  }
  const user = await findById(payload.sub);
  if (!user || b(user.disabled)) return oauthError('invalid_token', 'User no longer valid', 401);
  return json(userClaims(user, String(payload.scope ?? 'openid')));
}

export const GET = handle;
export const POST = handle;
