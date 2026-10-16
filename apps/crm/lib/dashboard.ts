// The dashboard's numbers: the pipeline rollup plus a few short lists to act on.
import { q } from "./db";
import * as leads from "./leads";
import * as opps from "./opportunities";
import type { PipelineSummary } from "./pipeline";
import type { Ctx, Lead, Opportunity } from "./types";

export type Dashboard = {
  pipeline: PipelineSummary;
  mine: PipelineSummary;
  counts: { accounts: number; contacts: number; openLeads: number; myOpenActivities: number };
  leadsByStatus: Record<string, number>;
  recentLeads: Lead[];
  closingSoon: Opportunity[];
};

export async function dashboard(ctx: Ctx): Promise<Dashboard> {
  const [pipeline, mine, [counts], byStatus, recent, open] = await Promise.all([
    opps.summary(),
    opps.summary(ctx.email),
    q<Dashboard["counts"]>(
      `SELECT (SELECT count(*)::int FROM accounts) AS accounts,
              (SELECT count(*)::int FROM contacts) AS contacts,
              (SELECT count(*)::int FROM leads WHERE status NOT IN ('converted','unqualified')) AS "openLeads",
              (SELECT count(*)::int FROM activities WHERE assignee = $1 AND status = 'open' AND type <> 'note') AS "myOpenActivities"`,
      [ctx.email],
    ),
    q<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM leads GROUP BY status"),
    leads.list(ctx, { status: "open" }),
    opps.list(ctx, { stage: "open" }),
  ]);
  return {
    pipeline,
    mine,
    counts,
    leadsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    recentLeads: recent.slice(0, 6),
    closingSoon: open.filter((o) => o.closeDate).slice(0, 6),
  };
}
