import { gunzipSync } from "node:zlib";
import { raise } from "./alerts";
import { audit, q, tx } from "./db";
import { type AlertDraft, detect, matchIndicators } from "./detections";
import { type DeviceColumns, type Row, type SoftwareRow, applySnapshot, postureChanges } from "./facts";
import { type Platform, osqueryConfig, platformOf, queriesFor, queryByName } from "./queries";
import type { Facts } from "./rules";
import { recompute } from "./state";
import { scanDevice } from "./vulns";
import { secret, sha256, text } from "./util";

/**
 * The osquery TLS server: the five endpoints osqueryd calls when started with --config_plugin=tls,
 * --logger_plugin=tls and --distributed_plugin=tls (https://osquery.readthedocs.io/en/stable/deployment/remote/).
 *
 *   POST /api/osquery/enroll             { enroll_secret, host_identifier, host_details } → { node_key }
 *   POST /api/osquery/config             { node_key } → the schedule (lib/queries.ts)
 *   POST /api/osquery/log                { node_key, log_type, data } → {}
 *   POST /api/osquery/distributed/read   { node_key } → { queries: { id: sql } }
 *   POST /api/osquery/distributed/write  { node_key, queries: { id: rows }, statuses, messages } → {}
 *
 * A bad or retired node key answers { node_invalid: true }, which makes osqueryd enroll again with
 * its enroll secret; a revoked secret then keeps it out.
 */

export class OsqueryError extends Error {}

export type Device = { id: string; platform: Platform; owner: string | null; facts: Facts };

/** Reads an osquery request body, gzip-compressed when --logger_tls_compress is on. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = Buffer.from(await req.arrayBuffer());
  const gz = /gzip/i.test(req.headers.get("content-encoding") ?? "") || (raw[0] === 0x1f && raw[1] === 0x8b);
  // Software lists are large; 50 MB uncompressed is far more than any real report.
  const buf = gz ? gunzipSync(raw, { maxOutputLength: 50 * 1024 * 1024 }) : raw;
  try {
    const v = JSON.parse(buf.toString("utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new OsqueryError("Bad request body");
  }
}

export function clientIp(req: Request): string | null {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || null;
}

type HostDetails = {
  os_version?: Record<string, string>;
  system_info?: Record<string, string>;
  osquery_info?: Record<string, string>;
  platform_info?: Record<string, string>;
};

export async function enroll(b: Record<string, unknown>, ip: string | null): Promise<{ node_key: string } | { node_invalid: true }> {
  const supplied = text(b.enroll_secret, 500);
  const host = text(b.host_identifier, 300);
  if (!supplied || !host) return { node_invalid: true };
  const [s] = await q<{ id: string; owner: string | null }>(
    `UPDATE enroll_secrets SET last_used_at = now() WHERE secret_hash = $1 AND revoked_at IS NULL RETURNING id, owner`,
    [sha256(supplied)],
  );
  if (!s) return { node_invalid: true };

  const details = (b.host_details ?? {}) as HostDetails;
  const os = details.os_version ?? {};
  const sys = details.system_info ?? {};
  const platform = platformOf(os.platform, os.platform_like);
  const nodeKey = secret();

  const result = await tx(async (tq) => {
    const [existing] = await tq<{ id: string; owner: string | null; retired_at: Date | null }>(
      `SELECT id, owner, retired_at FROM devices WHERE host_identifier = $1 FOR UPDATE`,
      [host],
    );
    // Someone else's personal enrollment can't take over a device that belongs to a person.
    if (existing && !existing.retired_at && existing.owner && s.owner && existing.owner !== s.owner) return null;
    const cols = [
      host, sha256(nodeKey), s.id, s.owner, text(sys.computer_name || sys.hostname, 300), platform,
      text(os.name, 200), text(os.version, 100).replace(/\s*\(.*\)\s*$/, ""), text(sys.hardware_vendor, 200), text(sys.hardware_model, 200),
      text(sys.hardware_serial, 200), text(sys.cpu_brand, 200), Number(sys.physical_memory) || null, text(details.osquery_info?.version, 50), ip,
    ];
    const [row] = await tq<{ id: string }>(
      `INSERT INTO devices (host_identifier, node_key_hash, enroll_secret_id, owner, hostname, platform, os_name, os_version,
         hardware_vendor, hardware_model, hardware_serial, cpu, memory_bytes, osquery_version, last_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (host_identifier) DO UPDATE SET
         node_key_hash = $2, enroll_secret_id = $3,
         owner = CASE WHEN devices.retired_at IS NOT NULL THEN $4 ELSE COALESCE(devices.owner, $4) END,
         hostname = COALESCE(NULLIF($5, ''), devices.hostname), platform = $6,
         os_name = COALESCE(NULLIF($7, ''), devices.os_name), os_version = COALESCE(NULLIF($8, ''), devices.os_version),
         osquery_version = COALESCE(NULLIF($14, ''), devices.osquery_version), last_ip = $15, last_seen = now(),
         enrolled_at = CASE WHEN devices.retired_at IS NOT NULL THEN now() ELSE devices.enrolled_at END,
         retired_at = NULL, retired_by = NULL
       RETURNING id`,
      cols,
    );
    return row;
  });
  if (!result) return { node_invalid: true };
  // Scheduled queries first run up to an interval after osqueryd starts; ask for everything now.
  await queueRefresh([result.id], "Devices");
  await audit("Devices", "device.enroll", result.id, { host, ip, secret: s.id });
  return { node_key: nodeKey };
}

/** The device a node key belongs to, or null (unknown, or retired). Marks it seen. */
export async function authenticate(nodeKey: unknown, ip: string | null): Promise<Device | null> {
  const key = typeof nodeKey === "string" ? nodeKey : "";
  if (!key) return null;
  const [d] = await q<Device>(
    `UPDATE devices SET last_seen = now(), last_ip = COALESCE($2, last_ip) WHERE node_key_hash = $1 AND retired_at IS NULL
     RETURNING id, platform, owner, facts`,
    [sha256(key), ip],
  );
  return d ?? null;
}

export function configFor(d: Device): Record<string, unknown> {
  return osqueryConfig(d.platform);
}

/** One query's result in any of osquery's result log formats. */
type Result = { name: string; snapshot?: Row[]; added: Row[]; baseline: boolean };

export function normalizeResults(data: unknown): Result[] {
  if (!Array.isArray(data)) return [];
  const out = new Map<string, Result>();
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e !== "object" || typeof e.name !== "string") continue;
    // counter 0 is a differential query's first run on this device: everything already there.
    const baseline = e.counter === 0 || e.counter === "0";
    const key = `${e.name}\u0000${baseline}`;
    const r = out.get(key) ?? { name: e.name, added: [], baseline };
    if (e.action === "snapshot" && Array.isArray(e.snapshot)) r.snapshot = e.snapshot as Row[];
    else if (e.action === "added" && e.columns && typeof e.columns === "object") r.added.push(e.columns as Row);
    else if (e.diffResults && typeof e.diffResults === "object") r.added.push(...(((e.diffResults as { added?: Row[] }).added ?? []) as Row[]));
    out.set(key, r);
  }
  return [...out.values()];
}

async function indicatorMap(): Promise<Map<string, string>> {
  const rows = await q<{ sha256: string; title: string }>(`SELECT sha256, title FROM indicators`);
  return new Map(rows.map((r) => [r.sha256, r.title]));
}

/** Applies snapshots and differential rows from a device and raises whatever they show. */
export async function ingest(d: Device, results: Result[]): Promise<{ alerts: number }> {
  let columns: DeviceColumns = {};
  let facts: Facts = {};
  const software: { source: string; rows: SoftwareRow[] }[] = [];
  const drafts: AlertDraft[] = [];
  let indicators: Map<string, string> | null = null;

  for (const r of results) {
    const def = queryByName(r.name);
    if (!def) continue;
    if (r.snapshot) {
      if (def.id === "process_hashes") {
        indicators ??= await indicatorMap();
        drafts.push(...matchIndicators(r.snapshot, indicators));
        continue;
      }
      const applied = applySnapshot(def.id, r.snapshot);
      if (applied?.columns) columns = { ...columns, ...applied.columns };
      if (applied?.facts) facts = { ...facts, ...applied.facts };
      if (applied?.software) software.push(applied.software);
    }
    if (r.added.length) {
      let baseline = r.baseline;
      if (!baseline) {
        const seen = await q(`SELECT 1 FROM baselines WHERE device_id = $1 AND query = $2`, [d.id, def.id]);
        baseline = seen.length === 0;
      }
      await q(`INSERT INTO baselines (device_id, query) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [d.id, def.id]);
      drafts.push(...detect(def.id, r.added, { baseline }));
    }
  }

  const changedFacts = Object.keys(facts).length > 0;
  if (changedFacts) {
    for (const c of postureChanges(d.facts ?? {}, facts)) {
      drafts.push({ ...c, fingerprint: sha256(`${c.detection}\u0000${JSON.stringify(c.detail)}`).slice(0, 32) });
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [d.id];
  for (const [k, v] of Object.entries(columns)) {
    if (v === undefined || v === "") continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (changedFacts) {
    params.push(JSON.stringify(facts));
    sets.push(`facts = facts || $${params.length}::jsonb`, `facts_at = now()`);
  }
  await tx(async (tq) => {
    if (sets.length) await tq(`UPDATE devices SET ${sets.join(", ")} WHERE id = $1`, params);
    for (const sw of software) {
      await tq(`DELETE FROM software WHERE device_id = $1 AND source = $2`, [d.id, sw.source]);
      for (let i = 0; i < sw.rows.length; i += 500) {
        const chunk = sw.rows.slice(i, i + 500);
        await tq(
          `INSERT INTO software (device_id, name, version, source, package)
           SELECT $1, n, v, $2, p FROM unnest($3::text[], $4::text[], $5::text[]) AS t(n, v, p)
           ON CONFLICT DO NOTHING`,
          [d.id, sw.source, chunk.map((x) => x.name), chunk.map((x) => x.version), chunk.map((x) => x.package)],
        );
      }
    }
  });

  const alerts = drafts.length ? await raise(d.id, drafts) : 0;
  if (sets.length || drafts.length) await recompute([d.id]);
  if (software.some((s) => s.source === "deb" || s.source === "rpm")) void scanSoon(d.id);
  return { alerts };
}

/** Checks a device's packages for vulnerabilities at most every 12 hours, in the background. */
async function scanSoon(deviceId: string): Promise<void> {
  try {
    const [due] = await q(`SELECT 1 FROM devices WHERE id = $1 AND (vulns_checked_at IS NULL OR vulns_checked_at < now() - interval '12 hours')`, [deviceId]);
    if (!due) return;
    if ((await scanDevice(deviceId)) !== null) await recompute([deviceId]);
  } catch (err) {
    console.error("[devices] vulnerability check", deviceId, (err as Error).message);
  }
}

export async function log(d: Device, b: Record<string, unknown>): Promise<{ alerts: number }> {
  // Status logs are osquery's own diagnostics; results are what the schedule found.
  if (b.log_type !== "result") return { alerts: 0 };
  return ingest(d, normalizeResults(b.data));
}

/** Asks devices to run every inventory and posture query now, through distributed queries. */
export async function queueRefresh(deviceIds: string[], actor: string): Promise<string> {
  const [lq] = await q<{ id: string }>(`INSERT INTO live_queries (sql, created_by) VALUES ('(refresh)', $1) RETURNING id`, [actor]);
  await q(
    `INSERT INTO live_targets (query_id, device_id, purpose) SELECT $1, unnest($2::uuid[]), 'refresh' ON CONFLICT DO NOTHING`,
    [lq.id, deviceIds],
  );
  return lq.id;
}

const SENT_TIMEOUT = "10 minutes";

export async function distributedRead(d: Device): Promise<{ queries: Record<string, string> }> {
  await q(
    `UPDATE live_targets SET status = 'error', error = 'The device did not answer', done_at = now()
     WHERE device_id = $1 AND status = 'sent' AND sent_at < now() - interval '${SENT_TIMEOUT}'`,
    [d.id],
  );
  const due = await q<{ query_id: string; purpose: "live" | "refresh"; sql: string }>(
    `UPDATE live_targets t SET status = 'sent', sent_at = now() FROM live_queries l
     WHERE t.query_id = l.id AND t.device_id = $1 AND t.status = 'pending'
     RETURNING t.query_id, t.purpose, l.sql`,
    [d.id],
  );
  const queries: Record<string, string> = {};
  for (const t of due) {
    if (t.purpose === "live") queries[`live:${t.query_id}`] = t.sql;
    else for (const def of queriesFor(d.platform)) if (def.purpose !== "detection") queries[`refresh:${t.query_id}:${def.id}`] = def.sql;
  }
  return { queries };
}

const MAX_LIVE_ROWS = 1000;

export async function distributedWrite(d: Device, b: Record<string, unknown>): Promise<void> {
  const results = (b.queries ?? {}) as Record<string, Row[]>;
  const statuses = (b.statuses ?? {}) as Record<string, number | string>;
  const messages = (b.messages ?? {}) as Record<string, string>;
  const keys = new Set([...Object.keys(results), ...Object.keys(statuses)]);
  const refreshed = new Map<string, Result[]>();

  for (const key of keys) {
    const failed = statuses[key] !== undefined && Number(statuses[key]) !== 0;
    const rows = Array.isArray(results[key]) ? results[key] : [];
    const [kind, queryId, sub] = key.split(":");
    if (!/^[0-9a-f-]{36}$/i.test(queryId ?? "")) continue;
    if (kind === "live") {
      await q(
        `UPDATE live_targets SET status = $3, rows = $4, error = $5, done_at = now()
         WHERE query_id = $1 AND device_id = $2 AND status IN ('pending', 'sent')`,
        [queryId, d.id, failed ? "error" : "done", JSON.stringify(rows.slice(0, MAX_LIVE_ROWS)),
          failed ? text(messages[key] || "The query failed on the device", 1000) : rows.length > MAX_LIVE_ROWS ? `Only the first ${MAX_LIVE_ROWS} of ${rows.length} rows were kept` : null],
      );
    } else if (kind === "refresh" && sub) {
      const list = refreshed.get(queryId) ?? [];
      if (!failed) list.push({ name: `synergy_${sub}`, snapshot: rows, added: [], baseline: false });
      refreshed.set(queryId, list);
    }
  }
  for (const [queryId, list] of refreshed) {
    await ingest(d, list);
    await q(`UPDATE live_targets SET status = 'done', done_at = now() WHERE query_id = $1 AND device_id = $2`, [queryId, d.id]);
  }
}

/** Wraps an osquery endpoint: reads the body, finds the device by node key, answers node_invalid otherwise. */
export function osqueryRoute(fn: (d: Device, b: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      const b = await readBody(req);
      const d = await authenticate(b.node_key, clientIp(req));
      if (!d) return Response.json({ node_invalid: true });
      return Response.json((await fn(d, b)) ?? {});
    } catch (err) {
      if (err instanceof OsqueryError) return Response.json({ error: err.message }, { status: 400 });
      console.error("[devices] osquery", err);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
