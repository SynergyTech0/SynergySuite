import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";

/** What suite search can ask Devices for. */
export const KINDS = ["device", "alert"];

type Row = { id: string; kind: "device" | "alert"; title: string; body: string; owner: string | null; date: Date; device_id: string };

/**
 * Suite search for one person: admins find every device and alert, everyone else their own devices
 * and the alerts on them, by name, model, serial number, operating system, alert title and notes.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const kinds = s.kinds.length ? KINDS.filter((k) => s.kinds.includes(k)) : KINDS;
  if (!kinds.length) return { app: APP, results: [] };
  const params: unknown[] = [me.role === "admin", me.email, s.limit, kinds];
  const words = queryToSql(s.parsed, ["x.title", "x.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT * FROM (
       SELECT d.id, 'device' AS kind, d.hostname AS title,
         concat_ws(' ', d.hardware_vendor, d.hardware_model, d.hardware_serial, d.os_name, d.os_version, d.owner, d.notes) AS body,
         d.owner, d.last_seen AS date, d.id AS device_id
       FROM devices d WHERE d.retired_at IS NULL
       UNION ALL
       SELECT a.id, 'alert', a.title, concat_ws(' ', d.hostname, a.detail::text), d.owner, a.last_seen, d.id
       FROM alerts a JOIN devices d ON d.id = a.device_id WHERE d.retired_at IS NULL
     ) x
     WHERE ($1 OR x.owner = $2) AND x.kind = ANY($4) AND ${words.sql}
     ORDER BY x.date DESC, x.id LIMIT $3`,
    params,
  );
  const results = rows.map((r): SearchResult => ({
    id: r.id,
    kind: r.kind,
    title: r.title || "(unnamed device)",
    snippet: snippet(r.body, s.parsed),
    date: new Date(r.date).toISOString(),
    url: r.kind === "device" ? `/#/devices/${r.id}` : `/#/alerts/${r.id}`,
    ...(r.owner ? { person: r.owner } : {}),
    ...(s.text ? { text: clipText(`${r.title}\n${r.body}`) } : {}),
  }));
  return { app: APP, results };
}
