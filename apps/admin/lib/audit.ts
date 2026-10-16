import { q, type Tq } from "./db";
import { likeTerm, text } from "./util";

/**
 * The Admin center's own audit log: every hold change, search, export, download, role change and
 * user change. Rows are only ever added (the table refuses UPDATE and DELETE).
 */
export type AuditEntry = { id: string; at: string; actor: string; action: string; target: string; details: Record<string, unknown> };

export async function record(actor: string, action: string, target: string, details: Record<string, unknown> = {}, tq?: Tq): Promise<void> {
  const run = tq ?? q;
  await run(`INSERT INTO audit (actor, action, target, details) VALUES ($1, $2, $3, $4)`, [actor, action, target, JSON.stringify(details)]);
}

export type AuditFilter = { q?: string; actor?: string; action?: string; from?: string; to?: string; before?: string; limit?: number };

export async function list(f: AuditFilter = {}): Promise<{ entries: AuditEntry[]; more: boolean; actions: string[] }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (p: string) => string, v: unknown) => {
    params.push(v);
    where.push(sql(`$${params.length}`));
  };
  const s = text(f.q, 200);
  if (s) add((p) => `(actor ILIKE ${p} OR action ILIKE ${p} OR target ILIKE ${p} OR details::text ILIKE ${p})`, likeTerm(s));
  const actor = text(f.actor, 254).toLowerCase();
  if (actor) add((p) => `actor ILIKE ${p}`, likeTerm(actor));
  const action = text(f.action, 80);
  if (action) add((p) => `(action = ${p} OR action LIKE ${p} || '.%')`, action);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from ?? "")) add((p) => `at >= ${p}::date`, f.from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to ?? "")) add((p) => `at < ${p}::date + 1`, f.to);
  if (/^\d+$/.test(f.before ?? "")) add((p) => `id < ${p}::bigint`, f.before);
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const rows = await q<{ id: string; at: Date; actor: string; action: string; target: string; details: Record<string, unknown> }>(
    `SELECT id::text, at, actor, action, target, details FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY audit.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const actions = await q<{ action: string }>(`SELECT DISTINCT action FROM audit ORDER BY action`);
  return {
    entries: rows.slice(0, limit).map((r) => ({ ...r, at: r.at.toISOString() })),
    more: rows.length > limit,
    actions: actions.map((a) => a.action),
  };
}
