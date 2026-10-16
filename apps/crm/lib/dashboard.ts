// The dashboard's numbers: the pipeline rollup plus a few short lists to act on.
import { visible } from "./access";
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
  // Counts cover only what this person can see (lib/access.ts).
  const cp: unknown[] = [ctx.email];
  const counts = `SELECT (SELECT count(*)::int FROM accounts a WHERE ${visible(ctx, "account", "a", cp)}) AS accounts,
              (SELECT count(*)::int FROM contacts c WHERE ${visible(ctx, "contact", "c", cp)}) AS contacts,
              (SELECT count(*)::int FROM leads l WHERE l.status NOT IN ('converted','unqualified') AND ${visible(ctx, "lead", "l", cp)}) AS "openLeads",
              (SELECT count(*)::int FROM activities WHERE assignee = $1 AND status = 'open' AND type <> 'note') AS "myOpenActivities"`;
  const sp: unknown[] = [];
  const byStatusSql = `SELECT l.status, count(*)::int AS n FROM leads l WHERE ${visible(ctx, "lead", "l", sp)} GROUP BY l.status`;
  const [pipeline, mine, [countRow], byStatus, recent, open] = await Promise.all([
    opps.summary(ctx),
    opps.summary(ctx, ctx.email),
    q<Dashboard["counts"]>(counts, cp),
    q<{ status: string; n: number }>(byStatusSql, sp),
    leads.list(ctx, { status: "open" }),
    opps.list(ctx, { stage: "open" }),
  ]);
  return {
    pipeline,
    mine,
    counts: countRow,
    leadsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    recentLeads: recent.slice(0, 6),
    closingSoon: open.filter((o) => o.closeDate).slice(0, 6),
  };
}
