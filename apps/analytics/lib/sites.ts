import { randomBytes } from "node:crypto";
import { isAdmin, type Me } from "./api";
import { cleanDomain } from "./collect";
import { q } from "./db";
import { UserError, text } from "./util";

export type Site = { id: string; site_key: string; name: string; domain: string; owner_email: string; created_at: Date };
export type SiteRow = Site & { events_30d: number; can_manage: boolean };

const COLS = "id::text, site_key, name, domain, owner_email, created_at";

function siteId(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{1,18}$/.test(s)) throw new UserError("Not found", 404);
  return s;
}

export const newKey = () => `sy_${randomBytes(9).toString("base64url")}`;

/** Every signed-in person can see every site's numbers; there is nothing personal in them. */
export async function listSites(me: Me): Promise<SiteRow[]> {
  const rows = await q<Site & { events_30d: number }>(
    `SELECT s.id::text, s.site_key, s.name, s.domain, s.owner_email, s.created_at,
       (SELECT count(*) FROM events e WHERE e.site_id = s.id AND e.at > now() - interval '30 days')::int AS events_30d
     FROM sites s ORDER BY lower(s.name), s.id`,
  );
  return rows.map((r) => ({ ...r, can_manage: canManage(me, r) }));
}

export function canManage(me: Me, site: Pick<Site, "owner_email">): boolean {
  return isAdmin(me.email) || site.owner_email.toLowerCase() === me.email.toLowerCase();
}

export async function getSite(id: string): Promise<Site> {
  const [s] = await q<Site>(`SELECT ${COLS} FROM sites WHERE id = $1`, [siteId(id)]);
  if (!s) throw new UserError("Not found", 404);
  return s;
}

export async function createSite(me: Me, b: { name?: unknown; domain?: unknown }): Promise<Site> {
  const name = text(b.name, 120);
  if (!name) throw new UserError("Give the site a name");
  const domain = cleanDomain(b.domain);
  if (domain && !/^[a-z0-9.-]+$/.test(domain)) throw new UserError("Enter the site's domain, like example.com");
  const [s] = await q<Site>(`INSERT INTO sites (site_key, name, domain, owner_email) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`, [
    newKey(),
    name,
    domain,
    me.email,
  ]);
  return s;
}

export async function updateSite(me: Me, id: string, b: { name?: unknown; domain?: unknown }): Promise<Site> {
  const cur = await getSite(id);
  if (!canManage(me, cur)) throw new UserError("Only the site's owner or an Analytics admin can change it", 403);
  const name = b.name === undefined ? cur.name : text(b.name, 120);
  if (!name) throw new UserError("Give the site a name");
  const domain = b.domain === undefined ? cur.domain : cleanDomain(b.domain);
  if (domain && !/^[a-z0-9.-]+$/.test(domain)) throw new UserError("Enter the site's domain, like example.com");
  const [s] = await q<Site>(`UPDATE sites SET name = $2, domain = $3 WHERE id = $1 RETURNING ${COLS}`, [cur.id, name, domain]);
  return s;
}

export async function deleteSite(me: Me, id: string): Promise<void> {
  const cur = await getSite(id);
  if (!canManage(me, cur)) throw new UserError("Only the site's owner or an Analytics admin can delete it", 403);
  await q(`DELETE FROM sites WHERE id = $1`, [cur.id]);
}

export type Stats = {
  site: Site;
  days: number;
  bucket: "hour" | "day";
  totals: { pageviews: number; visitors: number; events: number };
  series: { t: string; pageviews: number; visitors: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  topRefs: { source: string; visitors: number }[];
  topEvents: { name: string; count: number }[];
  devices: { device: string; visitors: number }[];
  live: number;
};

/** The dashboard for one site over the last `days` days (1 to 90). */
export async function stats(id: string, daysIn: unknown, now = new Date()): Promise<Stats> {
  const site = await getSite(id);
  const days = Math.min(90, Math.max(1, Math.floor(Number(daysIn) || 7)));
  const bucket = days <= 2 ? "hour" : "day";
  const p = [site.id, days, now];
  const range = `site_id = $1 AND at > $3::timestamptz - make_interval(days => $2) AND at <= $3::timestamptz`;
  const [totals] = await q<Stats["totals"]>(
    `SELECT count(*) FILTER (WHERE kind = 'pageview')::int AS pageviews, count(DISTINCT visitor)::int AS visitors,
       count(*) FILTER (WHERE kind = 'event')::int AS events
     FROM events WHERE ${range}`,
    p,
  );
  const series = await q<{ t: Date; pageviews: number; visitors: number }>(
    `SELECT date_trunc('${bucket}', at, 'UTC') AS t, count(*) FILTER (WHERE kind = 'pageview')::int AS pageviews,
       count(DISTINCT visitor)::int AS visitors
     FROM events WHERE ${range} GROUP BY 1 ORDER BY 1`,
    p,
  );
  const topPages = await q<Stats["topPages"][number]>(
    `SELECT path, count(*)::int AS views, count(DISTINCT visitor)::int AS visitors
     FROM events WHERE ${range} AND kind = 'pageview' GROUP BY path ORDER BY views DESC, path LIMIT 12`,
    p,
  );
  const topRefs = await q<Stats["topRefs"][number]>(
    `SELECT COALESCE(NULLIF(ref_host, ''), '(direct)') AS source, count(DISTINCT visitor)::int AS visitors
     FROM events WHERE ${range} AND kind = 'pageview' GROUP BY 1 ORDER BY visitors DESC, source LIMIT 12`,
    p,
  );
  const topEvents = await q<Stats["topEvents"][number]>(
    `SELECT name, count(*)::int AS count FROM events WHERE ${range} AND kind = 'event' GROUP BY name ORDER BY count DESC, name LIMIT 12`,
    p,
  );
  const devices = await q<Stats["devices"][number]>(
    `SELECT COALESCE(NULLIF(device, ''), 'unknown') AS device, count(DISTINCT visitor)::int AS visitors
     FROM events WHERE ${range} GROUP BY 1 ORDER BY visitors DESC`,
    p,
  );
  const [{ n: live }] = await q<{ n: number }>(
    `SELECT count(DISTINCT visitor)::int AS n FROM events WHERE site_id = $1 AND at > $2::timestamptz - interval '5 minutes' AND at <= $2::timestamptz`,
    [site.id, now],
  );
  return {
    site,
    days,
    bucket,
    totals,
    series: series.map((s) => ({ ...s, t: new Date(s.t).toISOString() })),
    topPages,
    topRefs,
    topEvents,
    devices,
    live,
  };
}

/** Drops events older than ANALYTICS_RETENTION_DAYS; with it unset, events are kept. */
export async function prune(days = Number(process.env.ANALYTICS_RETENTION_DAYS) || 0): Promise<void> {
  if (!days || days < 1) return;
  await q(`DELETE FROM events WHERE at < now() - make_interval(days => $1)`, [Math.floor(days)]);
}
