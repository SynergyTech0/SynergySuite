import { currentUser } from '@/lib/session';
import { appsForUser } from '@/lib/apps';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/*
 * The signed-in user's assigned apps — the single source of truth for both the
 * Synergy Hub launcher and the 9-dot waffle embedded in every app. Session-authed
 * (SynergyAuth cookie); the waffle reaches it same-origin from an auth.* iframe.
 */
export async function GET(req: Request) {
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthenticated' }, 401);
  const apps = await appsForUser(auth.user.id);
  return json({
    user: { email: auth.user.email, name: auth.user.name },
    apps: apps.map((a) => ({
      slug: a.slug,
      name: a.name,
      description: a.description,
      url: a.url,
      icon: a.icon,
      color: a.color,
      category: a.category,
    })),
  });
}
