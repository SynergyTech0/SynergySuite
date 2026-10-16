import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/server-session';
import { appsForUser } from '@/lib/apps';
import HubClient, { type HubApp } from './HubClient';
import '../hub.css';

/* The tab said "SynergyAuth" on every launcher visit — the identity
   provider's name, not the product's. Google's launcher tab says the
   product. */
export const metadata = { title: "Synergy" };

export const dynamic = 'force-dynamic';

/*
 * The Synergy Hub launcher. After sign-in the user lands here and sees a tile
 * for each app they're entitled to (open-to-all apps + their explicit grants).
 *
 * Entitlement resolution stays server-side in appsForUser() — the client is
 * only ever handed the apps this user may already see, so search and filtering
 * cannot reveal the existence of an app they have no grant for.
 */

/*
 * Stamps the saved theme on <html> while the document is still parsing, before
 * the body paints. Without this, the preference is read in an effect and anyone
 * who chose light on a dark machine (or the reverse) sees the wrong theme for a
 * frame on every navigation. Google resolves theme before paint; so do we.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('sh-theme');
if(t==='light'||t==='dark')document.documentElement.setAttribute('data-sh-theme',t);}catch(e){}})();`;

export default async function HubPage() {
  const auth = await pageUser();
  if (!auth) redirect('/login?return_to=%2Fhub');
  const { user } = auth;

  const rows = await appsForUser(user.id);

  const apps: HubApp[] = rows.map((a) => ({
    slug: a.slug,
    name: a.name ?? a.slug,
    description: a.description ?? '',
    url: a.url ?? '#',
    color: a.color ?? null,
    category: a.category ?? 'Apps',
  }));

  return (
    <>
      {/* font-display: swap without a preload paints Arial first and reflows. */}
      <link rel="preload" as="font" type="font/woff2" href="/fonts/roboto-var.woff2" crossOrigin="anonymous" />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <HubClient
        apps={apps}
        name={user.name ?? ''}
        email={user.email}
        isAdmin={user.role === 'admin' || user.role === 'superadmin'}
      />
    </>
  );
}
