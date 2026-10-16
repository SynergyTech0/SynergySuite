import type { DlpSettings, Hold, LabelSettings, Policy, RetentionRule } from "@synergy/compliance";
import { q } from "./db";
import { dlpSettings, feedDlp, labelSettings } from "./protection";

/**
 * The policy feed every app reads (GET /api/svc/policy): who is on hold in which apps, and the
 * retention rules. Only active holds in open matters count; a released hold or a closed matter
 * lets the app delete again. It also carries the sensitivity labels and the DLP rules.
 */
export type PolicyHoldRow = { id: string; name: string; custodians: string[]; apps: string[]; active: boolean; matter_status: string };
export type PolicyRuleRow = { id: string; app: string; kind: string; days: number };

export function buildPolicy(holds: PolicyHoldRow[], rules: PolicyRuleRow[], changedAt: Date | string, extra: { labels?: LabelSettings; dlp?: DlpSettings } = {}): Policy {
  const out: Hold[] = holds
    .filter((h) => h.active && h.matter_status === "open")
    .map((h) => ({
      id: h.id,
      name: h.name,
      custodians: [...new Set(h.custodians.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort(),
      apps: [...new Set(h.apps)].sort(),
    }))
    .filter((h) => h.custodians.length > 0);
  const retention: RetentionRule[] = rules
    .filter((r) => Number.isInteger(r.days) && r.days >= 1)
    .map((r) => (r.kind ? { id: r.id, app: r.app, kind: r.kind, days: r.days } : { id: r.id, app: r.app, days: r.days }));
  return { holds: out, retention, updatedAt: new Date(changedAt).toISOString(), ...(extra.labels ? { labels: extra.labels } : {}), ...(extra.dlp ? { dlp: feedDlp(extra.dlp) } : {}) };
}

export async function currentPolicy(): Promise<Policy> {
  const [holds, rules, [state], labels, dlp] = await Promise.all([
    q<PolicyHoldRow>(
      `SELECT h.id, h.name, h.custodians, h.apps, h.active, m.status AS matter_status
       FROM holds h JOIN matters m ON m.id = h.matter_id WHERE h.active AND m.status = 'open' ORDER BY h.created_at`,
    ),
    q<PolicyRuleRow>(`SELECT id, app, kind, days FROM retention_rules ORDER BY app, kind`),
    q<{ changed_at: Date }>(`SELECT changed_at FROM policy_state WHERE id = 1`),
    labelSettings(),
    dlpSettings(),
  ]);
  return buildPolicy(holds, rules, state?.changed_at ?? new Date(0), { labels, dlp });
}

/** Notes that holds, retention, labels or DLP changed, so apps' cached policies are known to be stale. */
export const touchPolicy = `UPDATE policy_state SET changed_at = now() WHERE id = 1`;
