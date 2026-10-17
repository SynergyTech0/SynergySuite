import { json } from '@/lib/http';
import { verify } from '@/lib/app-passwords';
import { trustedInternal } from '@/lib/internal';

/* For Calendar and Contacts on the internal network: is this the person's app password? */

export async function POST(req: Request) {
  if (!trustedInternal(req)) return json({ error: 'forbidden' }, 403);
  const b = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; app?: unknown; ip?: unknown };
  const email = String(b.email ?? '').slice(0, 320);
  const password = String(b.password ?? '').slice(0, 200);
  if (!email || !password) return json({ error: 'invalid' }, 401);
  const r = await verify(email, password, String(b.app ?? 'app'), String(b.ip ?? '').slice(0, 64));
  if (r.ok) return json({ email: r.email });
  return json({ error: r.reason }, r.reason === 'locked' ? 429 : 401);
}
