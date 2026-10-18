import { q } from "./db";
import { listIncidents, type IncidentWithUpdates } from "./incidents";
import { getSettings, type PageSettings } from "./settings";

export type PublicMonitor = {
  id: string;
  name: string;
  up: boolean | null;
  uptime_30d: number | null;
  latency_24h: number | null;
  days: { day: string; pct: number }[];
};

export type PublicPage = {
  settings: PageSettings;
  overall: "operational" | "degraded" | "incident" | "unknown";
  monitors: PublicMonitor[];
  incidents: IncidentWithUpdates[];
  updatedAt: string;
};

/**
 * What the public status page shows: the public, active monitors with their last result,
 * 30-day uptime and a bar per day, and recent incidents. No addresses or error text leave here.
 */
export async function publicPage(): Promise<PublicPage> {
  const monitors = await q<Omit<PublicMonitor, "days">>(
    `SELECT m.id::text, m.name,
       (SELECT ok FROM checks c WHERE c.monitor_id = m.id ORDER BY checked_at DESC LIMIT 1) AS up,
       (SELECT round(avg(CASE WHEN ok THEN 100.0 ELSE 0 END), 2)::float FROM checks c
         WHERE c.monitor_id = m.id AND c.checked_at > now() - interval '30 days') AS uptime_30d,
       (SELECT round(avg(latency_ms))::int FROM checks c
         WHERE c.monitor_id = m.id AND c.ok AND c.checked_at > now() - interval '24 hours') AS latency_24h
     FROM monitors m WHERE m.public AND m.active ORDER BY m.sort, m.id`,
  );
  const days = monitors.length
    ? await q<{ monitor_id: string; day: string; pct: number }>(
        `SELECT monitor_id::text, to_char(date_trunc('day', checked_at), 'YYYY-MM-DD') AS day,
           round(avg(CASE WHEN ok THEN 100.0 ELSE 0 END))::int AS pct
         FROM checks WHERE monitor_id = ANY($1::bigint[]) AND checked_at > now() - interval '30 days'
         GROUP BY 1, 2 ORDER BY 2`,
        [monitors.map((m) => m.id)],
      )
    : [];
  const incidents = (await listIncidents(10)).filter(
    (i) => i.status !== "resolved" || (i.resolved_at && Date.now() - new Date(i.resolved_at).getTime() < 14 * 86_400_000),
  );
  const open = incidents.some((i) => i.status !== "resolved");
  const anyDown = monitors.some((m) => m.up === false);
  const anyKnown = monitors.some((m) => m.up !== null);
  return {
    settings: await getSettings(),
    overall: open ? "incident" : anyDown ? "degraded" : anyKnown ? "operational" : "unknown",
    monitors: monitors.map((m) => ({ ...m, days: days.filter((d) => d.monitor_id === m.id).map(({ day, pct }) => ({ day, pct })) })),
    incidents: incidents.map((i) => ({ ...i, created_by: "", updates: i.updates.map((u) => ({ ...u, author: "" })) })),
    updatedAt: new Date().toISOString(),
  };
}
