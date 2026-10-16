import { q } from "./db";
import { addDays, weekStart } from "./dates";
import { listTasks, overallPercent, roleOn } from "./projects";

export type ProjectReport = {
  percentDone: number;
  tasks: { total: number; done: number; late: number };
  /** Minutes by status. */
  hours: { draft: number; submitted: number; approved: number; rejected: number; total: number; budget: number | null };
  /** Last 12 weeks, oldest first. */
  weeks: { week: string; minutes: number }[];
  people: { email: string; minutes: number; thisWeek: number; weeklyMinutes: number; assignedMinutes: number; costCents?: number; valueCents?: number }[];
  /** Managers only. */
  money?: {
    currency: string;
    budgetCents: number | null;
    billedCents: number;
    unbilledCents: number;
    awaitingApprovalCents: number;
    costCents: number;
    expensesCents: number;
  };
};

/**
 * One project in numbers. Approved time is valued at the rates fixed when it was approved; time
 * not approved yet at today's rates from the team list.
 */
export async function projectReport(email: string, projectId: string, today: string): Promise<ProjectReport> {
  const role = await roleOn(email, projectId);
  const tasks = await listTasks(email, projectId);
  const leaves = tasks.filter((t) => !t.summary);
  const week = weekStart(today);
  const [p] = await q<{ budget_minutes: number | null; budget_cents: string | null; currency: string; default_rate_cents: string | null }>(
    `SELECT budget_minutes, budget_cents, currency, default_rate_cents FROM projects WHERE id = $1::uuid`,
    [projectId],
  );
  const status = await q<{ status: string; m: string }>(
    `SELECT status, sum(minutes) AS m FROM time_entries WHERE project_id = $1::uuid AND held_deleted_at IS NULL GROUP BY status`,
    [projectId],
  );
  const by = Object.fromEntries(status.map((s) => [s.status, Number(s.m)]));
  const weeks = await q<{ week: string; m: string }>(
    `SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week, sum(minutes) AS m FROM time_entries
     WHERE project_id = $1::uuid AND held_deleted_at IS NULL AND day >= $2 GROUP BY 1`,
    [projectId, addDays(week, -77)],
  );
  const weekMap = new Map(weeks.map((w) => [w.week, Number(w.m)]));
  const people = await q<{
    email: string; weekly_minutes: number; minutes: string; this_week: string; cost: string; value: string;
  }>(
    `SELECT m.email, m.weekly_minutes,
       COALESCE(sum(e.minutes), 0) AS minutes,
       COALESCE(sum(e.minutes) FILTER (WHERE e.day >= $2 AND e.day < $3), 0) AS this_week,
       COALESCE(sum(e.minutes * COALESCE(e.cost_cents, m.cost_rate_cents, 0) / 60.0), 0) AS cost,
       COALESCE(sum(e.minutes * COALESCE(e.rate_cents, m.bill_rate_cents, p.default_rate_cents, 0) / 60.0) FILTER (WHERE e.billable), 0) AS value
     FROM members m JOIN projects p ON p.id = m.project_id
     LEFT JOIN time_entries e ON e.project_id = m.project_id AND e.person = m.email AND e.held_deleted_at IS NULL
     WHERE m.project_id = $1::uuid GROUP BY m.email, m.weekly_minutes ORDER BY m.email`,
    [projectId, week, addDays(week, 7)],
  );
  // Time this week across every project, against each person's weekly hours.
  const busy = await q<{ person: string; m: string }>(
    `SELECT person, sum(minutes) AS m FROM time_entries WHERE person = ANY($1) AND day >= $2 AND day < $3 AND held_deleted_at IS NULL GROUP BY person`,
    [people.map((x) => x.email), week, addDays(week, 7)],
  );
  const busyMap = new Map(busy.map((b) => [b.person, Number(b.m)]));
  const assigned = new Map<string, number>();
  for (const t of leaves) {
    if (!t.assignedTo || t.percentDone >= 100) continue;
    const left = Math.max(0, (t.estimateMinutes ?? 0) * (1 - t.percentDone / 100));
    assigned.set(t.assignedTo, (assigned.get(t.assignedTo) ?? 0) + Math.round(left));
  }
  const manager = role === "manager";
  const report: ProjectReport = {
    percentDone: overallPercent(tasks),
    tasks: {
      total: leaves.length,
      done: leaves.filter((t) => t.percentDone >= 100).length,
      late: leaves.filter((t) => t.percentDone < 100 && t.finish && t.finish < today).length,
    },
    hours: {
      draft: by.draft ?? 0, submitted: by.submitted ?? 0, approved: by.approved ?? 0, rejected: by.rejected ?? 0,
      total: Object.values(by).reduce((s: number, n) => s + (n as number), 0), budget: p.budget_minutes,
    },
    weeks: Array.from({ length: 12 }, (_, i) => {
      const w = addDays(week, (i - 11) * 7);
      return { week: w, minutes: weekMap.get(w) ?? 0 };
    }),
    people: people.map((x) => ({
      email: x.email,
      minutes: Number(x.minutes),
      thisWeek: busyMap.get(x.email) ?? 0,
      weeklyMinutes: x.weekly_minutes,
      assignedMinutes: assigned.get(x.email) ?? 0,
      ...(manager ? { costCents: Math.round(Number(x.cost)), valueCents: Math.round(Number(x.value)) } : {}),
    })),
  };
  if (manager) {
    const [m] = await q<{ billed: string; unbilled: string; waiting: string; expenses: string; exp_unbilled: string }>(
      `SELECT
         COALESCE((SELECT sum(total_cents) FROM invoices WHERE project_id = $1::uuid), 0) AS billed,
         COALESCE((SELECT sum(e.minutes * COALESCE(e.rate_cents, 0) / 60.0) FROM time_entries e
            WHERE e.project_id = $1::uuid AND e.status = 'approved' AND e.billable AND e.invoice_id IS NULL AND e.held_deleted_at IS NULL AND p.billing = 'time'), 0) AS unbilled,
         COALESCE((SELECT sum(e.minutes * COALESCE(mm.bill_rate_cents, p.default_rate_cents, 0) / 60.0) FROM time_entries e
            LEFT JOIN members mm ON mm.project_id = e.project_id AND mm.email = e.person
            WHERE e.project_id = $1::uuid AND e.status = 'submitted' AND e.billable AND e.held_deleted_at IS NULL AND p.billing = 'time'), 0) AS waiting,
         COALESCE((SELECT sum(amount_cents) FROM expenses x WHERE x.project_id = $1::uuid AND x.held_deleted_at IS NULL AND x.status <> 'rejected'), 0) AS expenses,
         COALESCE((SELECT sum(amount_cents) FROM expenses x WHERE x.project_id = $1::uuid AND x.status = 'approved' AND x.billable AND x.invoice_id IS NULL
            AND x.held_deleted_at IS NULL AND p.billing <> 'none'), 0) AS exp_unbilled
       FROM projects p WHERE p.id = $1::uuid`,
      [projectId],
    );
    report.money = {
      currency: p.currency,
      budgetCents: p.budget_cents === null ? null : Number(p.budget_cents),
      billedCents: Number(m.billed),
      unbilledCents: Math.round(Number(m.unbilled)) + Number(m.exp_unbilled),
      awaitingApprovalCents: Math.round(Number(m.waiting)),
      costCents: report.people.reduce((s, x) => s + (x.costCents ?? 0), 0) + Number(m.expenses),
      expensesCents: Number(m.expenses),
    };
  }
  return report;
}
