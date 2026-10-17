import { json, formBody } from '@/lib/http';
import { currentUser } from '@/lib/session';
import { q } from '@/lib/db';
import { allApps, createLinkedApp, updateApp, deleteApp, grantApp, revokeApp, grantees, type App } from '@/lib/apps';
import { findByEmail } from '@/lib/users';
import { audit } from '@/lib/audit';

async function requireAdmin(req: Request) {
  const auth = await currentUser(req);
  if (!auth || auth.user.role !== 'admin') return null;
  return auth;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function validUrl(u: string): boolean {
  try {
    const p = new URL(u).protocol;
    return p === 'https:' || p === 'http:';
  } catch {
    return false;
  }
}

const flag = (v: string | null) => (v === null ? undefined : v === '1' || v === 'true');

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const apps = await allApps();
  return json({
    apps: await Promise.all(apps.map(async (a) => ({
      id: String(a.id), slug: a.slug, name: a.name, description: a.description, url: a.url,
      category: a.category, color: a.color, sort: Number(a.sort),
      open_to_all: Number(a.open_to_all) !== 0, disabled: Number(a.disabled) !== 0, suite: Number(a.suite) !== 0,
      granted: Number(a.open_to_all) !== 0 ? [] : await grantees(a.id),
    }))),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth) return json({ error: 'forbidden' }, 403);
  const body = await formBody(req);
  const action = body.get('action') ?? '';

  if (action === 'create') {
    const slug = (body.get('slug') ?? '').trim().toLowerCase();
    const name = (body.get('name') ?? '').trim();
    const url = (body.get('url') ?? '').trim();
    if (!SLUG.test(slug)) return json({ error: 'Short name: lowercase letters, numbers and dashes' }, 400);
    if (!name) return json({ error: 'Name is required' }, 400);
    if (!validUrl(url)) return json({ error: 'Address must start with https:// or http://' }, 400);
    if ((await q(`SELECT id FROM sa_apps WHERE slug = $1::text`, [slug])).length) {
      return json({ error: `An app called ${slug} already exists` }, 400);
    }
    const id = await createLinkedApp({
      slug, name, url,
      description: body.get('description') ?? undefined,
      category: body.get('category') || undefined,
      open_to_all: flag(body.get('open_to_all')),
    });
    await audit('admin.app_created', auth.user.email, { slug, url }, req);
    return json({ ok: true, id });
  }

  const id = body.get('id') ?? '';
  const rows = await q<App>(`SELECT * FROM sa_apps WHERE id = $1::bigint`, [id]);
  const app = rows[0];
  if (!app) return json({ error: 'not_found' }, 404);
  const suite = Number(app.suite) !== 0;

  if (action === 'update') {
    const url = body.get('url');
    if (!suite && url !== null && !validUrl(url)) return json({ error: 'Address must start with https:// or http://' }, 400);
    const sort = body.get('sort');
    await updateApp(app.id, {
      name: body.get('name') ?? undefined,
      description: body.get('description') ?? undefined,
      category: body.get('category') ?? undefined,
      url: url ?? undefined,
      sort: sort !== null && /^\d+$/.test(sort) ? Number(sort) : undefined,
      open_to_all: flag(body.get('open_to_all')),
      disabled: flag(body.get('disabled')),
    }, suite);
    await audit('admin.app_updated', auth.user.email, { slug: app.slug }, req);
    return json({ ok: true });
  }

  if (action === 'delete') {
    if (suite) return json({ error: 'Suite apps can be hidden but not removed' }, 400);
    await deleteApp(app.id);
    await audit('admin.app_deleted', auth.user.email, { slug: app.slug }, req);
    return json({ ok: true });
  }

  if (action === 'grant' || action === 'revoke') {
    const user = await findByEmail((body.get('email') ?? '').trim().toLowerCase());
    if (!user) return json({ error: 'No account with that email' }, 404);
    if (action === 'grant') await grantApp(user.id, app.id);
    else await revokeApp(user.id, app.id);
    await audit(`admin.app_${action}`, auth.user.email, { slug: app.slug, email: user.email }, req);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
}
