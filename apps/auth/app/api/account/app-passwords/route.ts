import { json, sameOrigin } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { isDemoUser } from '@/lib/config';
import { create, list } from '@/lib/app-passwords';

export async function GET(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  return json({ appPasswords: await list(auth.user.id) });
}

export async function POST(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  if (!sameOrigin(req)) return json({ error: 'cross_site' }, 403);
  if (isDemoUser(auth.user.email)) {
    return json({ error: 'demo_account', message: "App passwords can't be made for the shared demo account." }, 403);
  }
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return json({ error: 'name', message: 'Name the device or app, e.g. "iPhone".' }, 400);
  try {
    const made = await create(auth.user.id, name);
    await audit('app_password.created', auth.user.email, { id: made.id, name }, req);
    return json({ id: made.id, name, password: made.password });
  } catch (e) {
    return json({ error: 'limit', message: (e as Error).message }, 400);
  }
}
