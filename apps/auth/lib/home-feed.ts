/*
 * What the Home page shows from the person's own apps: the next few calendar events, the latest
 * mail in the inbox and the documents they touched last.
 *
 * Auth asks each app on the compose network as that person, the way the gateway would (the
 * x-auth-request-* headers plus PROXY_SHARED_SECRET), so every app applies its own access rules
 * and Home never sees more than the person could open themselves. Each part is optional: an app
 * the person can't use, one that is down or slow, or a deployment without PROXY_SHARED_SECRET
 * just leaves its card out (null). Nothing here is cached or stored.
 */

export type FeedEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location: string };
export type FeedMail = { uid: number; subject: string; from: string; date: string | null; unread: boolean };
export type FeedDoc = { id: string; kind: string; title: string; updated: string };

export type HomeFeed = {
  events: FeedEvent[] | null;
  mail: { unread: number; messages: FeedMail[] } | null;
  docs: FeedDoc[] | null;
};

type Viewer = { email: string; name: string };

/* Where each app listens on the compose network (packages/config/apps.json). HOME_FEED_URLS,
   a JSON object such as {"calendar":"http://localhost:3130"}, overrides them. */
const PORTS: Record<string, number> = { calendar: 3130, mail: 3200, office: 3070 };

function baseUrl(app: string): string {
  try {
    const o = JSON.parse(process.env.HOME_FEED_URLS || '{}')[app];
    if (typeof o === 'string' && o) return o.replace(/\/+$/, '');
  } catch { /* not JSON: use the defaults */ }
  return `http://${app}:${PORTS[app]}`;
}

async function get<T>(app: string, path: string, viewer: Viewer, ms: number): Promise<T | null> {
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(`${baseUrl(app)}${path}`, {
      headers: {
        'x-auth-request-email': viewer.email,
        'x-auth-request-preferred-username': viewer.name,
        'x-auth-request-user': viewer.email,
        'x-proxy-auth-secret': secret,
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'manual',
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

async function events(viewer: Viewer, ms: number): Promise<FeedEvent[] | null> {
  // From midnight-ish yesterday to two days out: the browser picks "today" in its own time zone.
  const now = Date.now();
  const from = new Date(now - 36 * 3_600_000).toISOString();
  const to = new Date(now + 48 * 3_600_000).toISOString();
  const rows = await get<unknown[]>('calendar', `/api/events?from=${from}&to=${to}`, viewer, ms);
  if (!Array.isArray(rows)) return null;
  return rows
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      id: str(r.id, 80) || `${str(r.series_id, 80)}:${str(r.occurrence, 40)}`,
      title: str(r.title) || '(no title)',
      start: str(r.start_at, 40),
      end: str(r.end_at, 40),
      allDay: r.all_day === true,
      location: str(r.location, 200),
    }))
    .filter((e) => e.start && !Number.isNaN(Date.parse(e.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

async function mail(viewer: Viewer, ms: number): Promise<HomeFeed['mail']> {
  const [folders, list] = await Promise.all([
    get<{ folders?: { path: string; unread: number }[] }>('mail', '/api/folders?account=suite', viewer, ms),
    get<{ messages?: Record<string, unknown>[] }>('mail', '/api/messages?account=suite&folder=INBOX', viewer, ms),
  ]);
  if (!list || !Array.isArray(list.messages)) return null;
  const inbox = folders?.folders?.find((f) => f.path === 'INBOX');
  return {
    unread: typeof inbox?.unread === 'number' ? inbox.unread : list.messages.filter((m) => m.seen !== true).length,
    messages: list.messages.slice(0, 5).map((m) => {
      const from = (m.from ?? {}) as Record<string, unknown>;
      return {
        uid: typeof m.uid === 'number' ? m.uid : 0,
        subject: str(m.subject) || '(no subject)',
        from: str(from.name, 120) || str(from.address, 200),
        date: str(m.date, 40) || null,
        unread: m.seen !== true,
      };
    }),
  };
}

async function docs(viewer: Viewer, ms: number): Promise<FeedDoc[] | null> {
  const body = await get<{ documents?: Record<string, unknown>[] }>('office', '/api/docs', viewer, ms);
  if (!body || !Array.isArray(body.documents)) return null;
  return body.documents.slice(0, 5).map((d) => ({
    id: str(d.id, 80),
    kind: str(d.kind, 20),
    title: str(d.title) || 'Untitled',
    updated: str(d.updated_at, 40),
  })).filter((d) => d.id);
}

/** The Home feed for one person; `has` says which apps they may open (others aren't asked). */
export async function homeFeed(viewer: Viewer, has: (slug: string) => boolean, ms = 2500): Promise<HomeFeed> {
  const [e, m, d] = await Promise.all([
    has('calendar') ? events(viewer, ms) : null,
    has('mail') ? mail(viewer, ms) : null,
    has('office') ? docs(viewer, ms) : null,
  ]);
  return { events: e, mail: m, docs: d };
}
