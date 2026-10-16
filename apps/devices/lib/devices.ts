import type { Me } from "./api";
import { audit, q } from "./db";
import { queueRefresh } from "./osquery";
import { BASELINE, parseRules } from "./rules";
import { recompute, recomputeStale } from "./state";
import { cleanEmail, text, UserError, uuid } from "./util";

/** Devices, policies, indicators and live queries as the screens use them. */

export type DeviceSummary = {
  id: string; hostname: string; owner: string | null; platform: string; os_name: string; os_version: string;
  hardware_model: string; compliance: string; last_seen: Date; open_alerts: number; worst_alert: string | null; vulns: number;
};

const SUMMARY = `SELECT d.id, d.hostname, d.owner, d.platform, d.os_name, d.os_version, d.hardware_model, d.compliance, d.last_seen,
  (SELECT count(*)::int FROM alerts a WHERE a.device_id = d.id AND a.status IN ('new', 'investigating')) AS open_alerts,
  (SELECT a.severity FROM alerts a WHERE a.device_id = d.id AND a.status IN ('new', 'investigating')
    ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 1) AS worst_alert,
  (SELECT count(*)::int FROM vulnerabilities v WHERE v.device_id = d.id) AS vulns
  FROM devices d`;

/** Who may see a device: admins, and its owner. */
function visible(me: Me): [string, unknown[]] {
  return me.role === "admin" ? ["TRUE", []] : ["d.owner = $1", [me.email]];
}

export async function listDevices(me: Me, f: { q?: string; compliance?: string; platform?: string; mine?: boolean } = {}): Promise<DeviceSummary[]> {
  await recomputeStale();
  const [where, params] = me.role === "admin" && !f.mine ? visible(me) : (["d.owner = $1", [me.email]] as [string, unknown[]]);
  const p = [...params];
  const conds = [where, "d.retired_at IS NULL"];
  if (f.q) {
    p.push(`%${f.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%`);
    conds.push(`(lower(d.hostname) LIKE $${p.length} OR lower(coalesce(d.owner, '')) LIKE $${p.length} OR lower(d.hardware_serial) LIKE $${p.length} OR lower(d.hardware_model) LIKE $${p.length})`);
  }
  if (f.compliance) {
    p.push(f.compliance);
    conds.push(`d.compliance = $${p.length}`);
  }
  if (f.platform) {
    p.push(f.platform);
    conds.push(`d.platform = $${p.length}`);
  }
  return q<DeviceSummary>(`${SUMMARY} WHERE ${conds.join(" AND ")} ORDER BY d.last_seen DESC LIMIT 1000`, p);
}

export async function getDevice(me: Me, id: string) {
  const [where, params] = visible(me);
  const [d] = await q<Record<string, unknown> & { id: string; owner: string | null; hostname: string }>(
    `SELECT d.id, d.host_identifier, d.hostname, d.owner, d.platform, d.os_name, d.os_version, d.hardware_vendor, d.hardware_model,
       d.hardware_serial, d.cpu, d.memory_bytes, d.osquery_version, d.facts, d.facts_at, d.compliance, d.compliance_detail,
       d.compliance_at, d.notes, d.last_ip, d.enrolled_at, d.last_seen, d.vulns_checked_at, d.retired_at,
       s.name AS enrolled_with
     FROM devices d LEFT JOIN enroll_secrets s ON s.id = d.enroll_secret_id
     WHERE d.id = $${params.length + 1} AND ${where}`,
    [...params, uuid(id, "device")],
  );
  if (!d) throw new UserError("No such device", 404);
  const [counts] = await q<{ software: number; vulns: Record<string, number> | null }>(
    `SELECT (SELECT count(*)::int FROM software WHERE device_id = $1) AS software,
       (SELECT jsonb_object_agg(severity, n) FROM (SELECT severity, count(*)::int AS n FROM vulnerabilities WHERE device_id = $1 GROUP BY severity) x) AS vulns`,
    [d.id],
  );
  return { ...d, software_count: counts.software, vuln_counts: counts.vulns ?? {} };
}

export async function software(me: Me, id: string, search = "") {
  await getDevice(me, id);
  return q<{ name: string; version: string; source: string }>(
    `SELECT name, version, source FROM software WHERE device_id = $1 AND ($2 = '' OR lower(name) LIKE $2) ORDER BY lower(name), version LIMIT 2000`,
    [id, search ? `%${search.toLowerCase().replace(/[%_\\]/g, "\\$&")}%` : ""],
  );
}

export async function deviceVulns(me: Me, id: string) {
  await getDevice(me, id);
  return q(
    `SELECT vuln_id, package, version, severity, score, summary, fixed_version FROM vulnerabilities WHERE device_id = $1
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, score DESC NULLS LAST, vuln_id`,
    [id],
  );
}

export async function updateDevice(me: Me, id: string, v: { owner?: unknown; notes?: unknown }): Promise<void> {
  if (me.role !== "admin") throw new UserError("Only device admins can change devices", 403);
  await getDevice(me, id);
  if (v.owner !== undefined) {
    const owner = v.owner === null || v.owner === "" ? null : cleanEmail(v.owner);
    await q(`UPDATE devices SET owner = $2 WHERE id = $1`, [id, owner]);
    await audit(me.email, "device.owner", id, { owner });
  }
  if (v.notes !== undefined) await q(`UPDATE devices SET notes = $2 WHERE id = $1`, [id, text(v.notes, 4000)]);
}

/**
 * Retire: the device's node key stops working, so osquery on it can no longer report, and it leaves
 * every list. Its history (alerts, inventory) is kept. Reinstalling with a valid key enrolls it again.
 */
export async function retire(me: Me, id: string): Promise<void> {
  const d = await getDevice(me, id);
  if (me.role !== "admin" && d.owner !== me.email) throw new UserError("No such device", 404);
  await q(`UPDATE devices SET retired_at = now(), retired_by = $2, node_key_hash = NULL WHERE id = $1`, [id, me.email]);
  await q(`UPDATE live_targets SET status = 'error', error = 'Device retired', done_at = now() WHERE device_id = $1 AND status IN ('pending', 'sent')`, [id]);
  await audit(me.email, "device.retire", id, { hostname: d.hostname });
}

export async function refresh(me: Me, id: string): Promise<void> {
  await getDevice(me, id);
  await queueRefresh([id], me.email);
}

export async function overview() {
  await recomputeStale();
  const [o] = await q<Record<string, number>>(
    `SELECT
       count(*)::int AS devices,
       count(*) FILTER (WHERE compliance = 'compliant')::int AS compliant,
       count(*) FILTER (WHERE compliance = 'noncompliant')::int AS noncompliant,
       count(*) FILTER (WHERE compliance = 'unknown')::int AS unknown,
       count(*) FILTER (WHERE last_seen < now() - interval '7 days')::int AS stale,
       count(*) FILTER (WHERE owner IS NULL)::int AS unowned,
       count(*) FILTER (WHERE (facts->>'disk_encryption')::boolean)::int AS encrypted,
       count(*) FILTER (WHERE platform = 'windows')::int AS windows,
       count(*) FILTER (WHERE platform = 'darwin')::int AS darwin,
       count(*) FILTER (WHERE platform = 'linux')::int AS linux
     FROM devices WHERE retired_at IS NULL`,
  );
  const alerts = await q<{ severity: string; n: number }>(
    `SELECT a.severity, count(*)::int AS n FROM alerts a JOIN devices d ON d.id = a.device_id
     WHERE a.status IN ('new', 'investigating') AND d.retired_at IS NULL GROUP BY a.severity`,
  );
  const vulns = await q<{ severity: string; n: number; devices: number }>(
    `SELECT v.severity, count(DISTINCT v.vuln_id)::int AS n, count(DISTINCT v.device_id)::int AS devices
     FROM vulnerabilities v JOIN devices d ON d.id = v.device_id WHERE d.retired_at IS NULL GROUP BY v.severity`,
  );
  const failing = await q<{ check: string; n: number }>(
    `SELECT r->>'check' AS check, count(DISTINCT d.id)::int AS n FROM devices d, jsonb_array_elements(d.compliance_detail) r
     WHERE d.retired_at IS NULL AND r->>'outcome' = 'fail' GROUP BY 1 ORDER BY 2 DESC`,
  );
  return {
    ...o,
    alerts: Object.fromEntries(alerts.map((a) => [a.severity, a.n])),
    vulns: Object.fromEntries(vulns.map((v) => [v.severity, { advisories: v.n, devices: v.devices }])),
    failing,
  };
}

// Policies

export async function listPolicies() {
  return q(`SELECT p.id, p.name, p.description, p.platforms, p.rules, p.enabled, p.created_by, p.created_at, p.updated_at FROM policies p ORDER BY p.created_at`);
}

function platforms(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((p) => !["windows", "darwin", "linux"].includes(p))) throw new UserError("platforms must be windows, darwin or linux");
  return [...new Set(v as string[])].sort();
}

export async function createPolicy(me: Me, v: Record<string, unknown>): Promise<{ id: string }> {
  const src = v.template === "baseline" ? BASELINE : v;
  const name = text(src.name, 120);
  if (!name) throw new UserError("Give the policy a name");
  const rules = parseRules(src.rules);
  if (!rules.length) throw new UserError("Add at least one rule");
  const [row] = await q<{ id: string }>(
    `INSERT INTO policies (name, description, platforms, rules, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, text(src.description, 1000), platforms(src.platforms), JSON.stringify(rules), me.email],
  );
  await audit(me.email, "policy.create", row.id, { name });
  await recompute();
  return row;
}

export async function updatePolicy(me: Me, id: string, v: Record<string, unknown>): Promise<void> {
  const [p] = await q<{ id: string }>(`SELECT id FROM policies WHERE id = $1`, [uuid(id, "policy")]);
  if (!p) throw new UserError("No such policy", 404);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (v.name !== undefined) {
    const name = text(v.name, 120);
    if (!name) throw new UserError("Give the policy a name");
    set("name", name);
  }
  if (v.description !== undefined) set("description", text(v.description, 1000));
  if (v.platforms !== undefined) set("platforms", platforms(v.platforms));
  if (v.rules !== undefined) {
    const rules = parseRules(v.rules);
    if (!rules.length) throw new UserError("Add at least one rule");
    set("rules", JSON.stringify(rules));
  }
  if (v.enabled !== undefined) set("enabled", !!v.enabled);
  if (!sets.length) return;
  await q(`UPDATE policies SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  await audit(me.email, "policy.update", id, { fields: Object.keys(v) });
  await recompute();
}

export async function deletePolicy(me: Me, id: string): Promise<void> {
  const [p] = await q<{ name: string }>(`DELETE FROM policies WHERE id = $1 RETURNING name`, [uuid(id, "policy")]);
  if (!p) throw new UserError("No such policy", 404);
  await audit(me.email, "policy.delete", id, { name: p.name });
  await recompute();
}

// Indicators

export async function listIndicators() {
  return q(`SELECT sha256, title, added_by, added_at FROM indicators ORDER BY added_at DESC`);
}

export async function addIndicators(me: Me, v: { hashes?: unknown; title?: unknown }): Promise<number> {
  const title = text(v.title, 200);
  if (!title) throw new UserError("Say what the file is, e.g. the malware family or the incident");
  const hashes = [...new Set(String(v.hashes ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean))];
  const bad = hashes.find((h) => !/^[0-9a-f]{64}$/.test(h));
  if (bad) throw new UserError(`"${bad.slice(0, 20)}" is not a SHA-256 hash`);
  if (!hashes.length) throw new UserError("Paste at least one SHA-256 hash");
  if (hashes.length > 1000) throw new UserError("At most 1000 hashes at a time");
  await q(
    `INSERT INTO indicators (sha256, title, added_by) SELECT unnest($1::text[]), $2, $3 ON CONFLICT (sha256) DO UPDATE SET title = $2`,
    [hashes, title, me.email],
  );
  await audit(me.email, "indicator.add", "", { count: hashes.length, title });
  return hashes.length;
}

export async function removeIndicator(me: Me, hash: string): Promise<void> {
  await q(`DELETE FROM indicators WHERE sha256 = $1`, [hash.toLowerCase()]);
  await audit(me.email, "indicator.remove", hash);
}

// Vulnerabilities across the fleet

export async function fleetVulns(f: { severity?: string; q?: string }) {
  return q(
    `SELECT v.vuln_id, (array_agg(v.severity))[1] AS severity, max(v.score) AS score, max(v.summary) AS summary,
       array_agg(DISTINCT v.package) AS packages, count(DISTINCT v.device_id)::int AS devices,
       max(NULLIF(v.fixed_version, '')) AS fixed_version
     FROM vulnerabilities v JOIN devices d ON d.id = v.device_id
     WHERE d.retired_at IS NULL AND ($1::text IS NULL OR v.severity = $1)
       AND ($2::text IS NULL OR v.vuln_id ILIKE $2 OR v.package ILIKE $2 OR v.summary ILIKE $2)
     GROUP BY v.vuln_id
     ORDER BY min(CASE v.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END),
       count(DISTINCT v.device_id) DESC, v.vuln_id
     LIMIT 500`,
    [f.severity || null, f.q ? `%${f.q.replace(/[%_\\]/g, "\\$&")}%` : null],
  );
}

export async function vulnDevices(vulnId: string) {
  return q(
    `SELECT d.id, d.hostname, d.owner, v.package, v.version, v.fixed_version FROM vulnerabilities v JOIN devices d ON d.id = v.device_id
     WHERE v.vuln_id = $1 AND d.retired_at IS NULL ORDER BY d.hostname`,
    [vulnId],
  );
}

// Live queries (advanced hunting)

/** osquery runs SQLite, read-only by design; this only keeps obvious mistakes out. */
export function checkSql(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (!s) throw new UserError("Write a query");
  if (s.length > 10_000) throw new UserError("That query is too long");
  if (!/^(select|with|pragma\s+table_info)\b/i.test(s)) throw new UserError("Live queries must start with SELECT or WITH");
  if (/;\s*\S/.test(s.replace(/'([^']|'')*'/g, "''"))) throw new UserError("One statement at a time");
  return s;
}

export async function createLive(me: Me, v: { sql?: unknown; devices?: unknown; all?: unknown }): Promise<{ id: string; targets: number }> {
  const sql = checkSql(String(v.sql ?? ""));
  let ids: string[];
  if (v.all) {
    ids = (await q<{ id: string }>(`SELECT id FROM devices WHERE retired_at IS NULL AND last_seen > now() - interval '1 day'`)).map((r) => r.id);
  } else {
    if (!Array.isArray(v.devices) || !v.devices.length) throw new UserError("Pick at least one device");
    ids = (v.devices as unknown[]).map((d) => uuid(d, "device"));
  }
  if (!ids.length) throw new UserError("No device has reported in the last day");
  if (ids.length > 2000) throw new UserError("At most 2000 devices at a time");
  const [lq] = await q<{ id: string }>(`INSERT INTO live_queries (sql, created_by) VALUES ($1, $2) RETURNING id`, [sql, me.email]);
  const added = await q(
    `INSERT INTO live_targets (query_id, device_id) SELECT $1, id FROM devices WHERE id = ANY($2::uuid[]) AND retired_at IS NULL RETURNING device_id`,
    [lq.id, ids],
  );
  await audit(me.email, "live.run", lq.id, { sql, devices: added.length });
  return { id: lq.id, targets: added.length };
}

export async function listLive() {
  return q(
    `SELECT l.id, l.sql, l.created_by, l.created_at,
       count(t.*)::int AS targets, count(t.*) FILTER (WHERE t.status = 'done')::int AS done, count(t.*) FILTER (WHERE t.status = 'error')::int AS errors
     FROM live_queries l JOIN live_targets t ON t.query_id = l.id WHERE t.purpose = 'live'
     GROUP BY l.id ORDER BY l.created_at DESC LIMIT 50`,
  );
}

export async function getLive(id: string) {
  const [l] = await q(`SELECT id, sql, created_by, created_at FROM live_queries WHERE id = $1`, [uuid(id, "query")]);
  if (!l) throw new UserError("No such query", 404);
  const targets = await q(
    `SELECT t.device_id, d.hostname, d.platform, t.status, t.rows, t.error, t.sent_at, t.done_at
     FROM live_targets t JOIN devices d ON d.id = t.device_id WHERE t.query_id = $1 ORDER BY d.hostname`,
    [id],
  );
  return { ...l, targets };
}

export async function auditLog(limit = 200) {
  return q(`SELECT actor, action, target, detail, at FROM audit ORDER BY at DESC, id DESC LIMIT $1`, [Math.min(limit, 1000)]);
}
