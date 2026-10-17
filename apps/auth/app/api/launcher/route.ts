import { currentUser } from '@/lib/session';
import { appsForUser } from '@/lib/apps';
import { json, suiteCors } from '@/lib/http';

export const dynamic = 'force-dynamic';

/*
 * The app launcher in the suite header (<synergy-app-bar>): the same apps the Hub shows this
 * person (appsForUser: enabled, open to all or granted to them, in the admin's order), grouped
 * by category in the order the groups first appear. The header fetches it from every app's own
 * subdomain with the sign-in cookie, so it answers with CORS for the suite's origins only.
 * Signed out gets 401, and the header falls back to its built-in list of suite apps.
 */
export async function GET(req: Request) {
  const cors = suiteCors(req);
  const auth = await currentUser(req);
  if (!auth) return json({ error: 'unauthenticated' }, 401, cors);
  const groups = new Map<string, { slug: string; name: string; url: string; color: string | null; suite: boolean }[]>();
  for (const a of await appsForUser(auth.user.id)) {
    const category = a.category || 'Apps';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push({
      slug: a.slug,
      name: a.name ?? a.slug,
      url: a.url ?? '',
      color: a.color ?? null,
      suite: Number(a.suite) !== 0,
    });
  }
  return json({ groups: [...groups].map(([category, apps]) => ({ category, apps })) }, 200, cors);
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...suiteCors(req), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' },
  });
}
