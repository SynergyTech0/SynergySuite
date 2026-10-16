import { pageUser } from '@/lib/server-session';
import { appsForUser } from '@/lib/apps';
import WaffleFrame from './WaffleFrame';
import AppIcon from '../AppIcon';
import '../hub.css';

export const dynamic = 'force-dynamic';

/*
 * Compact app grid rendered INSIDE the 9-dot waffle iframe (embedded in each
 * app via waffle.js). Same-site with the embedding app (*.<your domain>),
 * so the SynergyAuth session cookie flows and this shows the user's real apps.
 * Tiles navigate the TOP window (target=_top) so clicking launches the app.
 *
 * Shares hub.css with the launcher, so the waffle and the Hub stay visually
 * identical. The host passes its resolved theme as ?t=, because this frame
 * cannot see the host's preference and following prefers-color-scheme alone
 * would give a dark waffle to someone who forced light.
 */

/* Google's launcher labels the tile "Drive", not "Google Drive" — the suite name
   is already implied by the panel header. Dropping the prefix also stops long
   names breaking mid-word in a ~95px cell. The full name stays in the
   accessible name and the tooltip. */
/* Relative, not absolute. These were hardcoded to
   https://auth.<your domain>/hub while waffle.js derives its origin from
   its own script src — so on localhost or a staging host the frame's links
   pointed at production. The frame is served BY auth, so a relative path is
   already the right origin; target="_top" is what escapes the iframe. */
const HUB_HREF = '/hub';

const shortName = (n: string) => {
  // See HubClient's copy: slug-style names left the tile labelled "-aba".
  const s = (n || '').replace(/^synergy[\s_-]*/i, '').trim();
  return s || n;
};

/* The theme MUST be stamped on <html>, not on the wrapper div. Every icon-tone
   selector in hub.css keys on :root, and `html:has(.shw-root)` resolves its
   background at <html> too — so a div-level attribute left the frame resolving
   the wrong tone set in both directions (light tones at 2.89:1 on a dark panel,
   dark tones at 1.81:1 on a white one) and split the background at the gutter.
   This runs while the document is still parsing, before first paint. */
const THEME_BOOTSTRAP = `(function(){try{var t=new URLSearchParams(location.search).get('t');
if(t==='light'||t==='dark')document.documentElement.setAttribute('data-sh-theme',t);}catch(e){}})();`;

export default async function WafflePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  await searchParams;   // consumed by the inline bootstrap below

  const auth = await pageUser();

  if (!auth) {
    return (
      <>
        {/* Same preload as the Hub page. Without it this frame paints Arial,
            then reflows every tile label when Roboto arrives. */}
        <link rel="preload" as="font" type="font/woff2" href="/fonts/roboto-var.woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <div className="shw-root">
        <WaffleFrame />
        <div className="shw-head"><span>Synergy apps</span></div>
        <div className="shw-empty">
          <a href={HUB_HREF} target="_top">Sign in to Synergy →</a>
        </div>
        </div>
      </>
    );
  }

  const apps = await appsForUser(auth.user.id);

  return (
    <>
      <link rel="preload" as="font" type="font/woff2" href="/fonts/roboto-var.woff2" crossOrigin="anonymous" />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <div className="shw-root">
      <WaffleFrame />
      <div className="shw-head">
        <span>Synergy apps</span>
        <a href={HUB_HREF} target="_top" className="shw-all">All apps</a>
      </div>

      {apps.length === 0 ? (
        <div className="shw-empty">No apps assigned yet.</div>
      ) : (
        <div className="shw-grid">
          {apps.map((a) => (
            <a
              key={a.slug}
              className="shw-tile"
              href={a.url ?? '#'}
              target="_top"
              title={a.name ?? a.slug}
              aria-label={`${a.name ?? a.slug}${a.description ? ` — ${a.description}` : ''}`}
            >
              <AppIcon slug={a.slug} name={a.name ?? a.slug} color={a.color} size={44} />
              <span className="shw-name">{shortName(a.name ?? a.slug)}</span>
            </a>
          ))}
        </div>
      )}
      </div>
    </>
  );
}
