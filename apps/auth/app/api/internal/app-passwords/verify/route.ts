import { timingSafeEqual } from 'crypto';
import { json } from '@/lib/http';
import { verify } from '@/lib/app-passwords';

/*
 * For Calendar and Contacts on the internal network: is this the person's app password?
 * Proven by PROXY_SHARED_SECRET, which only the suite's apps and gateway have; the gateway also
 * refuses /api/internal/ from outside. Without the secret configured this answers nobody.
 */
function trusted(req: Request): boolean {
  const secret = process.env.PROXY_SHARED_SECRET ?? '';
  const given = Buffer.from(req.headers.get('x-proxy-auth-secret') ?? '');
  const want = Buffer.from(secret);
  return secret.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!trusted(req)) return json({ error: 'forbidden' }, 403);
  const b = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; app?: unknown; ip?: unknown };
  const email = String(b.email ?? '').slice(0, 320);
  const password = String(b.password ?? '').slice(0, 200);
  if (!email || !password) return json({ error: 'invalid' }, 401);
  const r = await verify(email, password, String(b.app ?? 'app'), String(b.ip ?? '').slice(0, 64));
  if (r.ok) return json({ email: r.email });
  return json({ error: r.reason }, r.reason === 'locked' ? 429 : 401);
}
