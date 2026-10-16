import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { UUID } from "./util";

/**
 * Devices' content for the Admin center: the devices a person owns (with what is installed on them)
 * and the security alerts raised on those devices, with the analysts' notes. Devices never deletes
 * either (retiring a device keeps its record), so a legal hold has nothing to stop here.
 */
export const KINDS = ["device", "alert"];

const DEVICE_TEXT = `concat_ws(' ', d.hostname, d.hardware_vendor, d.hardware_model, d.hardware_serial, d.os_name, d.os_version, d.notes)`;
const ALERT_NOTES = `COALESCE((SELECT string_agg(e.note, ' ' ORDER BY e.at) FROM alert_events e WHERE e.alert_id = a.id AND e.note <> ''), '')`;

type Hit = { id: string; kind: string; title: string; owner: string; body: string; date: Date; deleted: boolean; participants: string[] | null; total: string };

const UNION = `
  SELECT 'device:' || d.id AS id, 'device' AS kind, d.hostname AS title, d.owner, ${DEVICE_TEXT} AS body,
    d.last_seen AS date, d.retired_at IS NOT NULL AS deleted, NULL::text[] AS participants
  FROM devices d WHERE d.owner IS NOT NULL
  UNION ALL
  SELECT 'alert:' || a.id, 'alert', a.title, d.owner, concat_ws(' ', a.title, a.detail::text, ${ALERT_NOTES}),
    a.last_seen, false,
    ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[a.assigned_to, a.closed_by] || ARRAY(SELECT e.actor FROM alert_events e WHERE e.alert_id = a.id AND e.actor LIKE '%@%')) x
      WHERE x IS NOT NULL AND x <> d.owner)
  FROM alerts a JOIN devices d ON d.id = a.device_id WHERE d.owner IS NOT NULL`;

function hit(r: Hit, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title || "(unnamed device)",
    owner: r.owner,
    ...(r.participants?.length ? { participants: r.participants } : {}),
    date: new Date(r.date).toISOString(),
    snippet: snippet(r.body, s.query),
    size: Buffer.byteLength(r.body),
    ...(r.deleted ? { deleted: true } : {}),
  };
}

export async function search(s: Search): Promise<SearchResponse> {
  const kinds = s.kinds ?? KINDS;
  if (!kinds.length) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset, kinds];
  const words = queryToSql(s.query, ["x.title", "x.body"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Hit>(
    `SELECT x.*, COUNT(*) OVER () AS total FROM (${UNION}) x
     WHERE x.kind = ANY($6) AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR x.owner = ANY($1) OR x.participants && $1::text[])
       AND ($2::timestamptz IS NULL OR x.date >= $2)
       AND ($3::timestamptz IS NULL OR x.date < $3)
     ORDER BY x.date DESC, x.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const deviceIds = ids.filter((i) => i.startsWith("device:") && UUID.test(i.slice(7))).map((i) => i.slice(7));
  const alertIds = ids.filter((i) => i.startsWith("alert:") && UUID.test(i.slice(6))).map((i) => i.slice(6));
  const items: ExportItem[] = [];
  const none = { query: { groups: [], none: [] } } as Pick<Search, "query">;

  if (deviceIds.length) {
    const rows = await q<Hit & Record<string, unknown>>(
      `SELECT 'device:' || d.id AS id, 'device' AS kind, d.hostname AS title, d.owner, ${DEVICE_TEXT} AS body, d.last_seen AS date,
         d.retired_at IS NOT NULL AS deleted, NULL::text[] AS participants,
         d.host_identifier, d.platform, d.os_name, d.os_version, d.hardware_vendor, d.hardware_model, d.hardware_serial,
         d.facts, d.compliance, d.compliance_detail, d.enrolled_at, d.retired_at, d.retired_by, d.notes,
         (SELECT json_agg(json_build_object('name', s.name, 'version', s.version, 'source', s.source) ORDER BY lower(s.name))
            FROM software s WHERE s.device_id = d.id) AS software
       FROM devices d WHERE d.id = ANY($1::uuid[]) AND d.owner IS NOT NULL`,
      [deviceIds],
    );
    for (const r of rows) {
      const metadata: Record<string, unknown> = {};
      for (const k of ["host_identifier", "platform", "os_name", "os_version", "hardware_vendor", "hardware_model", "hardware_serial",
        "facts", "compliance", "compliance_detail", "enrolled_at", "retired_at", "retired_by", "notes"]) metadata[k] = r[k];
      items.push({
        ...hit(r, none),
        app: APP,
        metadata: { ...metadata, software: r.software ?? [] },
        text: [r.title, `${r.os_name} ${r.os_version}`, `${r.hardware_vendor} ${r.hardware_model} ${r.hardware_serial}`, r.notes]
          .map((x) => String(x ?? "").trim()).filter(Boolean).join("\n"),
      });
    }
  }
  if (alertIds.length) {
    const rows = await q<Hit & { hostname: string; device_id: string; severity: string; status: string; detail: unknown; detection: string; created_at: Date; events: unknown[] }>(
      `SELECT 'alert:' || a.id AS id, 'alert' AS kind, a.title, d.owner, concat_ws(' ', a.title, a.detail::text) AS body, a.last_seen AS date,
         false AS deleted, ARRAY[]::text[] AS participants, d.hostname, d.id AS device_id, a.severity, a.status, a.detail, a.detection, a.created_at,
         (SELECT json_agg(json_build_object('actor', e.actor, 'action', e.action, 'note', e.note, 'at', e.at) ORDER BY e.at) FROM alert_events e WHERE e.alert_id = a.id) AS events
       FROM alerts a JOIN devices d ON d.id = a.device_id WHERE a.id = ANY($1::uuid[]) AND d.owner IS NOT NULL`,
      [alertIds],
    );
    for (const r of rows) {
      items.push({
        ...hit(r, none),
        app: APP,
        metadata: { device: r.hostname, deviceId: r.device_id, severity: r.severity, status: r.status, detection: r.detection, detail: r.detail, raisedAt: r.created_at, events: r.events ?? [] },
        text: [r.title, JSON.stringify(r.detail), ...((r.events ?? []) as { note: string }[]).map((e) => e.note).filter(Boolean)].join("\n"),
      });
    }
  }
  items.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
  return { items };
}
