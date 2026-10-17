import type { Me } from "./api";
import { listChecks } from "./conflicts";
import { q } from "./db";
import { isTrustKeeper, visible } from "./law";
import { listAccounts } from "./trust";

/** The overview: what's due, what's unbilled, what needs deciding, and trust accounts needing attention. */
export async function dashboard(me: Me) {
  const [counts] = await q<{ open: number; mine: number }>(
    `SELECT count(*) FILTER (WHERE m.status <> 'closed')::int AS open,
       count(*) FILTER (WHERE m.status <> 'closed' AND (m.responsible = $1 OR EXISTS (SELECT 1 FROM matter_people p WHERE p.matter_id = m.id AND p.email = $1)))::int AS mine
     FROM matters m WHERE m.held_deleted_at IS NULL AND ${visible(me.email, 1)}`,
    [me.email],
  );
  const deadlines = await q(
    `SELECT d.id, d.matter_id, m.number, m.title AS matter_title, d.title, to_char(d.due_day, 'YYYY-MM-DD') AS due_day, d.basis, d.assignee,
       (d.due_day - CURRENT_DATE) AS days_left
     FROM deadlines d JOIN matters m ON m.id = d.matter_id
     WHERE d.done_at IS NULL AND m.held_deleted_at IS NULL AND d.due_day <= CURRENT_DATE + 14 AND ${visible(me.email, 1)}
       AND (d.assignee = $1 OR m.responsible = $1 OR EXISTS (SELECT 1 FROM matter_people p WHERE p.matter_id = m.id AND p.email = $1))
     ORDER BY d.due_day LIMIT 50`,
    [me.email],
  );
  const [time] = await q<{ week_minutes: string; unbilled_cents: string }>(
    `SELECT COALESCE(sum(minutes) FILTER (WHERE kind = 'time' AND day >= date_trunc('week', CURRENT_DATE)), 0) AS week_minutes,
       COALESCE(sum(CASE WHEN kind = 'time' THEN round(minutes * rate_cents / 60.0) ELSE amount_cents END) FILTER (WHERE bill_id IS NULL AND billable), 0) AS unbilled_cents
     FROM time_entries WHERE who = $1`,
    [me.email],
  );
  const checks = (await listChecks(me, 50)).filter((c) => (c as { decision: string }).decision === "pending");
  let trust = null;
  if (isTrustKeeper(me.email)) {
    const accounts = await listAccounts(me);
    const [{ failed }] = await q<{ failed: number }>(
      `SELECT count(*)::int AS failed FROM trust_txns WHERE books_status = 'failed' OR void_books_status = 'failed'`,
    );
    trust = {
      totalCents: accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balanceCents, 0),
      overdue: accounts.filter((a) => a.reconcileOverdue).map((a) => ({ id: a.id, name: a.name, last: a.last_reconciled, every: a.reconcileEvery })),
      booksFailed: failed,
    };
  }
  return {
    openMatters: counts.open,
    myMatters: counts.mine,
    deadlines,
    weekMinutes: Number(time.week_minutes),
    unbilledCents: Number(time.unbilled_cents),
    pendingChecks: checks,
    trust,
  };
}
