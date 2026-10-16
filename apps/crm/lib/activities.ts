// Activities: tasks, events, calls and notes attached to any record by type and id.
import { visible } from "./access";
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertMember } from "./members";
import { canEditActivity, resolveOwner } from "./permissions";
import { iso } from "./records";
import { ACTIVITY_STATUSES, ACTIVITY_TYPES, RECORD_TYPES, type Activity, type Ctx, type RecordType } from "./types";
import { ForbiddenError, UserError, isUuid, oneOf, required, text, timestamp } from "./util";

type Row = {
  id: string; type: Activity["type"]; subject: string; body: string; due_at: Date | null; status: Activity["status"];
  assignee: string; assignee_name: string; related_type: RecordType; related_id: string; related_name: string | null;
  created_by: string | null; created_at: Date;
};

const TABLE: Record<RecordType, string> = { account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities" };

const SELECT = `SELECT t.*,
  coalesce(nullif((SELECT m.name FROM members m WHERE m.email = t.assignee), ''), t.assignee) AS assignee_name,
  CASE t.related_type
    WHEN 'account' THEN (SELECT name FROM accounts WHERE id = t.related_id)
    WHEN 'contact' THEN (SELECT name FROM contacts WHERE id = t.related_id)
    WHEN 'lead' THEN (SELECT name FROM leads WHERE id = t.related_id)
    WHEN 'opportunity' THEN (SELECT name FROM opportunities WHERE id = t.related_id)
  END AS related_name
  FROM activities t`;

const who = (r: Row) => ({ assignee: r.assignee, createdBy: r.created_by });

function activityRow(ctx: Ctx, r: Row): Activity {
  return {
    id: r.id, type: r.type, subject: r.subject, body: r.body, dueAt: iso(r.due_at), status: r.status,
    assignee: r.assignee, assigneeName: r.assignee_name, relatedType: r.related_type, relatedId: r.related_id,
    relatedName: r.related_name ?? "", createdBy: r.created_by, createdAt: iso(r.created_at)!,
    editable: canEditActivity(ctx, who(r)),
  };
}

/** One record's timeline, newest first. */
export async function forRecord(ctx: Ctx, type: unknown, id: unknown): Promise<Activity[]> {
  const t = oneOf(type, RECORD_TYPES, "account", "record type");
  if (!isUuid(id)) return [];
  const params: unknown[] = [t, id];
  const rows = await q<Row>(
    `${SELECT} WHERE t.related_type = $1 AND t.related_id = $2 AND ${visible(ctx, "activity", "t", params)} ORDER BY t.created_at DESC`,
    params,
  );
  return rows.map((r) => activityRow(ctx, r));
}

/** Open tasks, events and calls assigned to me: dated first (soonest), then undated. */
export async function myDay(ctx: Ctx): Promise<Activity[]> {
  const rows = await q<Row>(
    `${SELECT} WHERE t.assignee = $1 AND t.status = 'open' AND t.type IN ('task','event','call')
     ORDER BY t.due_at IS NULL, t.due_at, t.created_at DESC LIMIT 500`,
    [ctx.email],
  );
  return rows.map((r) => activityRow(ctx, r));
}

async function load(ctx: Ctx, id: string): Promise<Row> {
  const params: unknown[] = [id];
  const [row] = await q<Row>(`${SELECT} WHERE t.id = $1 AND ${visible(ctx, "activity", "t", params)}`, params);
  if (!row) throw new UserError("Activity not found", 404);
  return row;
}

async function assigneeFor(ctx: Ctx, requested: unknown, current: string | null): Promise<string> {
  const want = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!want || want === current) return current ?? ctx.email;
  // Reps assign to themselves; managers and admins to anyone in the CRM.
  const who = resolveOwner(ctx, want);
  if (who !== ctx.email) await assertMember(who);
  return who;
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Activity> {
  const relatedType = oneOf(b.relatedType, RECORD_TYPES, "account", "record type");
  const relatedId = String(b.relatedId ?? "");
  if (!isUuid(relatedId)) throw new UserError("Pick a record");
  const pp: unknown[] = [relatedId];
  const [parent] = await q(`SELECT 1 FROM ${TABLE[relatedType]} r WHERE r.id = $1 AND ${visible(ctx, relatedType, "r", pp)}`, pp);
  if (!parent) throw new UserError("That record no longer exists", 404);
  const type = oneOf(b.type, ACTIVITY_TYPES, "note", "activity type");
  // A note is a record of something done; the rest start open.
  const status = oneOf(b.status, ACTIVITY_STATUSES, type === "note" ? "completed" : "open", "status");
  const assignee = await assigneeFor(ctx, b.assignee, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO activities (type, subject, body, due_at, status, assignee, related_type, related_id, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [type, required(b.subject, "Subject", 300), text(b.body, 5000), timestamp(b.dueAt), status, assignee, relatedType, relatedId, ctx.email],
  );
  return activityRow(ctx, await load(ctx, row.id));
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Activity> {
  const cur = await load(ctx, id);
  if (!canEditActivity(ctx, who(cur))) throw new ForbiddenError("Only the assignee, whoever logged it, or a manager can change this");
  const has = (k: string) => k in b && b[k] !== undefined;
  const type = has("type") ? oneOf(b.type, ACTIVITY_TYPES, cur.type, "activity type") : cur.type;
  const subject = has("subject") ? required(b.subject, "Subject", 300) : cur.subject;
  const body = has("body") ? text(b.body, 5000) : cur.body;
  const dueAt = has("dueAt") ? timestamp(b.dueAt) : iso(cur.due_at);
  const status = has("status") ? oneOf(b.status, ACTIVITY_STATUSES, cur.status, "status") : cur.status;
  const assignee = has("assignee") ? await assigneeFor(ctx, b.assignee, cur.assignee) : cur.assignee;
  await q(
    "UPDATE activities SET type=$2, subject=$3, body=$4, due_at=$5, status=$6, assignee=$7, updated_by=$8, updated_at=now() WHERE id = $1",
    [id, type, subject, body, dueAt, status, assignee, ctx.email],
  );
  return activityRow(ctx, await load(ctx, id));
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  const cur = await load(ctx, id);
  if (!canEditActivity(ctx, who(cur))) throw new ForbiddenError("Only the assignee, whoever logged it, or a manager can delete this");
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "activity", "t.id = $1", [id]);
    await tq("DELETE FROM activities WHERE id = $1", [id]);
  });
}
