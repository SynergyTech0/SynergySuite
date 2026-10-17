import { timingSafeEqual } from "node:crypto";
import { q } from "./db";
import { recomputeStale } from "./state";
import { RULES, type RuleResult } from "./rules";

/**
 * Service API for other suite apps, Bearer DEVICES_SVC_TOKEN over the internal network. Trust's
 * endpoint_compliance and endpoint_threats collectors read the posture summary as audit evidence.
 */
export function svcAuthorized(header: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.DEVICES_SVC_TOKEN ?? "";
  if (!token) return false;
  const got = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export type Posture = {
  generated_at: string;
  active_days: number;
  policies: number;
  devices: number;
  stale: number;
  compliant: number;
  noncompliant: number;
  unknown: number;
  encryption: { encrypted: number; not_encrypted: number; unknown: number };
  noncompliant_sample: { hostname: string; platform: string; failing: string[] }[];
  alerts_open: Record<"critical" | "high" | "medium" | "low", number>;
  oldest_open_days: Record<"critical" | "high", number | null>;
  vulnerabilities: { critical_devices: number; high_devices: number; critical_advisories: number; checked_devices: number };
};

export async function posture(activeDays = 30): Promise<Posture> {
  await recomputeStale();
  const days = Math.min(Math.max(Math.floor(activeDays) || 30, 1), 365);
  const [d] = await q<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1))::int AS devices,
       count(*) FILTER (WHERE last_seen < now() - make_interval(days => $1))::int AS stale,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND compliance = 'compliant')::int AS compliant,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND compliance = 'noncompliant')::int AS noncompliant,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND compliance = 'unknown')::int AS unknown,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND facts->>'disk_encryption' = 'true')::int AS encrypted,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND facts->>'disk_encryption' = 'false')::int AS not_encrypted,
       count(*) FILTER (WHERE last_seen >= now() - make_interval(days => $1) AND vulns_checked_at IS NOT NULL)::int AS checked
     FROM devices WHERE retired_at IS NULL`,
    [days],
  );
  const sample = await q<{ hostname: string; platform: string; failing: string[] }>(
    `SELECT hostname, platform, ARRAY(SELECT DISTINCT r->>'check' FROM jsonb_array_elements(compliance_detail) r WHERE r->>'outcome' = 'fail' ORDER BY 1) AS failing
     FROM devices WHERE retired_at IS NULL AND compliance = 'noncompliant' AND last_seen >= now() - make_interval(days => $1)
     ORDER BY hostname LIMIT 15`,
    [days],
  );
  const alerts = await q<{ severity: string; n: number; oldest: number | null }>(
    `SELECT a.severity, count(*)::int AS n, floor(extract(epoch FROM now() - min(a.created_at)) / 86400)::int AS oldest
     FROM alerts a JOIN devices d ON d.id = a.device_id WHERE a.status IN ('new', 'investigating') AND d.retired_at IS NULL GROUP BY a.severity`,
  );
  const [v] = await q<Record<string, number>>(
    `SELECT count(DISTINCT v.device_id) FILTER (WHERE v.severity = 'critical')::int AS critical_devices,
       count(DISTINCT v.device_id) FILTER (WHERE v.severity = 'high')::int AS high_devices,
       count(DISTINCT v.vuln_id) FILTER (WHERE v.severity = 'critical')::int AS critical_advisories
     FROM vulnerabilities v JOIN devices d ON d.id = v.device_id WHERE d.retired_at IS NULL`,
  );
  const [{ n: policies }] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM policies WHERE enabled`);
  const a = (s: string) => alerts.find((x) => x.severity === s);
  return {
    generated_at: new Date().toISOString(),
    active_days: days,
    policies,
    devices: d.devices,
    stale: d.stale,
    compliant: d.compliant,
    noncompliant: d.noncompliant,
    unknown: d.unknown,
    encryption: { encrypted: d.encrypted, not_encrypted: d.not_encrypted, unknown: d.devices - d.encrypted - d.not_encrypted },
    noncompliant_sample: sample,
    alerts_open: { critical: a("critical")?.n ?? 0, high: a("high")?.n ?? 0, medium: a("medium")?.n ?? 0, low: a("low")?.n ?? 0 },
    oldest_open_days: { critical: a("critical")?.oldest ?? null, high: a("high")?.oldest ?? null },
    vulnerabilities: { critical_devices: v.critical_devices, high_devices: v.high_devices, critical_advisories: v.critical_advisories, checked_devices: d.checked },
  };
}

export type AccessDevice = {
  id: string;
  name: string;
  platform: string;
  compliance: "compliant" | "noncompliant" | "unknown";
  failing: { label: string; detail: string }[];
  last_seen: string;
};

/**
 * One person's devices and whether each meets the compliance policies, for Auth's sign-in check
 * (conditional access). Retired devices don't count.
 */
export async function access(email: string): Promise<{ email: string; devices: AccessDevice[] }> {
  await recomputeStale();
  const e = email.trim().toLowerCase();
  const rows = await q<{ id: string; hostname: string; hardware_model: string; platform: string; compliance: AccessDevice["compliance"]; compliance_detail: RuleResult[]; last_seen: Date }>(
    `SELECT id, hostname, hardware_model, platform, compliance, compliance_detail, last_seen
     FROM devices WHERE retired_at IS NULL AND lower(owner) = $1 ORDER BY hostname, id`,
    [e],
  );
  const label = (check: string) => RULES.find((r) => r.check === check)?.label ?? check;
  return {
    email: e,
    devices: rows.map((d) => ({
      id: d.id,
      name: d.hostname || d.hardware_model || "Unnamed device",
      platform: d.platform,
      compliance: d.compliance,
      failing: (Array.isArray(d.compliance_detail) ? d.compliance_detail : [])
        .filter((r) => r.outcome === "fail")
        .map((r) => ({ label: label(r.check), detail: r.detail })),
      last_seen: new Date(d.last_seen).toISOString(),
    })),
  };
}
