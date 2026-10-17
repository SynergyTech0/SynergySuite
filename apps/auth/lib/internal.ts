import { timingSafeEqual } from 'crypto';

/*
 * Calls from the suite's other apps on the internal network (/api/internal/*) are proven by
 * PROXY_SHARED_SECRET, which only the suite's apps and gateway have; the gateway also refuses
 * /api/internal/ from outside. Without the secret configured these answer nobody.
 */
export function trustedInternal(req: Request): boolean {
  const secret = process.env.PROXY_SHARED_SECRET ?? '';
  const given = Buffer.from(req.headers.get('x-proxy-auth-secret') ?? '');
  const want = Buffer.from(secret);
  return secret.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}
