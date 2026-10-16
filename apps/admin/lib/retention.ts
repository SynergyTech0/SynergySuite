import { record } from "./audit";
import { suiteApps } from "./apps";
import { q, tx } from "./db";
import { touchPolicy } from "./policy";
import type { Me, RetentionRuleRecord } from "./types";
import { UserError, text, uuid } from "./util";

/**
 * Retention rules: an app (and optionally one kind of its content) and how many days content may
 * live. Apps delete older content for everyone who is not on hold. One rule per app and kind;
 * saving the same app and kind again changes its days.
 */

type Row = { id: string; app: string; kind: string; days: number; created_by: string; created_at: Date };

const toRule = (r: Row): RetentionRuleRecord => ({ id: r.id, app: r.app, kind: r.kind, days: r.days, createdBy: r.created_by, createdAt: r.created_at.toISOString() });

export async function list(): Promise<RetentionRuleRecord[]> {
  return (await q<Row>(`SELECT * FROM retention_rules ORDER BY app, kind`)).map(toRule);
}

export function cleanRule(v: Record<string, unknown>): { app: string; kind: string; days: number } {
  const app = text(v.app, 40);
  if (!suiteApps().some((a) => a.id === app)) throw new UserError("Pick an app");
  const kind = text(v.kind, 60).toLowerCase();
  if (kind && !/^[a-z0-9_.-]+$/.test(kind)) throw new UserError("A kind is one word, like message or file");
  const days = Number(v.days);
  if (!Number.isInteger(days) || days < 1 || days > 36500) throw new UserError("Days must be a whole number from 1 to 36500");
  return { app, kind, days };
}

export async function upsert(me: Me, v: Record<string, unknown>): Promise<RetentionRuleRecord> {
  const r = cleanRule(v);
  return tx(async (tq) => {
    const [before] = await tq<Row>(`SELECT * FROM retention_rules WHERE app = $1 AND kind = $2`, [r.app, r.kind]);
    const [row] = await tq<Row>(
      `INSERT INTO retention_rules (app, kind, days, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (app, kind) DO UPDATE SET days = EXCLUDED.days, created_by = EXCLUDED.created_by, created_at = now() RETURNING *`,
      [r.app, r.kind, r.days, me.email],
    );
    await tq(touchPolicy);
    await record(me.email, before ? "retention.update" : "retention.create", row.id, { ...r, kind: r.kind || "all", ...(before ? { daysBefore: before.days } : {}) }, tq);
    return toRule(row);
  });
}

export async function remove(me: Me, id: string): Promise<void> {
  await tx(async (tq) => {
    const [row] = await tq<Row>(`DELETE FROM retention_rules WHERE id = $1 RETURNING *`, [uuid(id, "That rule")]);
    if (!row) throw new UserError("That rule was not found", 404);
    await tq(touchPolicy);
    await record(me.email, "retention.delete", row.id, { app: row.app, kind: row.kind || "all", days: row.days }, tq);
  });
}

