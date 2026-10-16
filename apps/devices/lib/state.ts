import { type Q, q as defaultQ } from "./db";
import { type DeviceState, type Facts, type PolicyLike, type Rule, evaluate } from "./rules";

/** Compliance is stored on each device so lists, counts and Trust can read it without re-evaluating. */

type DeviceRow = {
  id: string; platform: string; os_version: string; last_seen: Date; facts: Facts; vulns_checked_at: Date | null;
};

export async function enabledPolicies(q: Q = defaultQ): Promise<PolicyLike[]> {
  const rows = await q<{ id: string; name: string; platforms: string[]; rules: Rule[]; enabled: boolean }>(
    `SELECT id, name, platforms, rules, enabled FROM policies WHERE enabled ORDER BY created_at`,
  );
  return rows;
}

async function stateOf(d: DeviceRow, q: Q): Promise<DeviceState> {
  const [counts] = await q<{ vulns: Record<string, number> | null; alerts: Record<string, number> | null }>(
    `SELECT
       (SELECT jsonb_object_agg(severity, n) FROM (SELECT severity, count(*)::int AS n FROM vulnerabilities WHERE device_id = $1 GROUP BY severity) v) AS vulns,
       (SELECT jsonb_object_agg(severity, n) FROM (SELECT severity, count(*)::int AS n FROM alerts WHERE device_id = $1 AND status IN ('new', 'investigating') GROUP BY severity) a) AS alerts`,
    [d.id],
  );
  const v = counts?.vulns ?? {};
  const a = counts?.alerts ?? {};
  return {
    platform: d.platform,
    osVersion: d.os_version,
    lastSeen: new Date(d.last_seen),
    facts: d.facts ?? {},
    vulns: { critical: v.critical ?? 0, high: v.high ?? 0, medium: v.medium ?? 0, low: v.low ?? 0, unknown: v.unknown ?? 0 },
    alerts: { critical: a.critical ?? 0, high: a.high ?? 0, medium: a.medium ?? 0, low: a.low ?? 0 },
    vulnsChecked: !!d.vulns_checked_at,
  };
}

/** Re-evaluates the given devices (all active ones when `ids` is omitted). */
export async function recompute(ids?: string[], q: Q = defaultQ, now = new Date()): Promise<void> {
  const policies = await enabledPolicies(q);
  const devices = await q<DeviceRow>(
    `SELECT id, platform, os_version, last_seen, facts, vulns_checked_at FROM devices
     WHERE retired_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1))`,
    [ids ?? null],
  );
  for (const d of devices) {
    const { state, results } = evaluate(policies, await stateOf(d, q), now);
    await q(`UPDATE devices SET compliance = $2, compliance_detail = $3, compliance_at = $4 WHERE id = $1`, [d.id, state, JSON.stringify(results), now]);
  }
}

/** "Checked in within N days" changes with time alone, so evaluations older than an hour are redone. */
export async function recomputeStale(q: Q = defaultQ): Promise<void> {
  const stale = await q<{ id: string }>(
    `SELECT id FROM devices WHERE retired_at IS NULL AND (compliance_at IS NULL OR compliance_at < now() - interval '1 hour') LIMIT 500`,
  );
  if (stale.length) await recompute(stale.map((r) => r.id), q);
}
