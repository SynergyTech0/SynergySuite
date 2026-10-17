import { holdChecker } from "./compliance";
import { type Asset, getAsset } from "./customers";
import { type Tq, q, tx } from "./db";
import { noteTicket } from "./desk";
import { type Role, rateFor, requireDispatcher, requireStaff } from "./staff";
import { UserError, minutes, text, uuidish } from "./util";

export const KINDS = ["repair", "install", "maintenance", "inspection"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const STATUSES = ["new", "scheduled", "in_progress", "on_hold", "completed", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export type WorkOrder = {
  id: string; number: string; title: string; description: string; kind: string; priority: string; status: Status; skill: string;
  customerId: string; customerName: string; customerEmail: string; assetId: string | null; assetName: string | null;
  address: string; contactName: string; contactPhone: string; dueDay: string | null; estimateMinutes: number; billable: boolean;
  deskTicket: string | null; resolution: string; signedBy: string; completedAt: string | null; completedBy: string | null;
  invoiceStatus: "none" | "sent" | "recorded"; booksNumber: string | null; invoiceTotalCents: number | null;
  nextVisit: { technician: string; startsAt: string } | null; createdAt: string; modifiedAt: string;
};

export type Booking = {
  id: string; workOrderId: string; technician: string; startsAt: string; endsAt: string;
  status: "scheduled" | "traveling" | "on_site" | "done" | "cancelled"; travelAt: string | null; arrivedAt: string | null; finishedAt: string | null;
};

export type Check = { id: string; title: string; doneBy: string | null; doneAt: string | null };
export type Note = { id: string; author: string; body: string; event: boolean; at: string };
export type FileInfo = { id: string; name: string; type: string; size: number; addedBy: string; at: string };
export type Labor = { id: string; technician: string; day: string; minutes: number; rateCents: number; notes: string };
export type Part = {
  id: string; sku: string; name: string; unit: string; qty: number; unitPriceCents: number;
  syncStatus: "local" | "pending" | "synced" | "failed"; syncError: string; addedBy: string; at: string;
};

export type WorkOrderDetail = WorkOrder & {
  asset: Asset | null; bookings: Booking[]; checklist: Check[]; notes: Note[]; files: FileInfo[]; labor: Labor[]; parts: Part[];
  signature: string | null; myRole: Role;
};

type Row = Record<string, unknown>;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export const WO_COLS = `w.id, w.number, w.title, w.description, w.kind, w.priority, w.status, w.skill, w.customer_id, c.name AS customer_name,
  c.email AS customer_email, w.asset_id, a.name AS asset_name, w.address, w.contact_name, w.contact_phone, to_char(w.due_day, 'YYYY-MM-DD') AS due_day,
  w.estimate_minutes, w.billable, w.desk_ticket, w.resolution, w.signed_by, w.completed_at, w.completed_by, w.invoice_status, w.books_number,
  w.invoice_total_cents, w.created_at, w.modified_at,
  (SELECT json_build_object('technician', b.technician, 'startsAt', b.starts_at) FROM bookings b
     WHERE b.work_order_id = w.id AND b.status IN ('scheduled', 'traveling', 'on_site') ORDER BY b.starts_at LIMIT 1) AS next_visit`;

export const WO_FROM = `work_orders w JOIN customers c ON c.id = w.customer_id LEFT JOIN assets a ON a.id = w.asset_id`;

export function toWorkOrder(r: Row): WorkOrder {
  const nv = r.next_visit as { technician: string; startsAt: string } | null;
  return {
    id: r.id as string, number: r.number as string, title: r.title as string, description: r.description as string, kind: r.kind as string,
    priority: r.priority as string, status: r.status as Status, skill: r.skill as string, customerId: r.customer_id as string,
    customerName: r.customer_name as string, customerEmail: r.customer_email as string, assetId: (r.asset_id as string) ?? null,
    assetName: (r.asset_name as string) ?? null, address: r.address as string, contactName: r.contact_name as string,
    contactPhone: r.contact_phone as string, dueDay: (r.due_day as string) ?? null, estimateMinutes: r.estimate_minutes as number,
    billable: r.billable as boolean, deskTicket: (r.desk_ticket as string) ?? null, resolution: r.resolution as string,
    signedBy: r.signed_by as string, completedAt: iso(r.completed_at), completedBy: (r.completed_by as string) ?? null,
    invoiceStatus: r.invoice_status as WorkOrder["invoiceStatus"], booksNumber: (r.books_number as string) ?? null,
    invoiceTotalCents: r.invoice_total_cents === null ? null : Number(r.invoice_total_cents),
    nextVisit: nv ? { technician: nv.technician, startsAt: new Date(nv.startsAt).toISOString() } : null,
    createdAt: iso(r.created_at)!, modifiedAt: iso(r.modified_at)!,
  };
}

export function toBooking(r: Row): Booking {
  return {
    id: r.id as string, workOrderId: r.work_order_id as string, technician: r.technician as string, startsAt: iso(r.starts_at)!,
    endsAt: iso(r.ends_at)!, status: r.status as Booking["status"], travelAt: iso(r.travel_at), arrivedAt: iso(r.arrived_at), finishedAt: iso(r.finished_at),
  };
}

/** Work orders a technician can open: the ones booked to them. */
export const TECH_SEES = `EXISTS (SELECT 1 FROM bookings b WHERE b.work_order_id = w.id AND b.technician = $1 AND b.status <> 'cancelled')`;

/** The person's role, after checking they may open this work order. */
export async function access(me: string, id: string): Promise<Role> {
  const role = await requireStaff(me);
  if (!uuidish(id)) throw new UserError("That work order doesn't exist", 404);
  const [r] = role === "technician"
    ? await q(`SELECT 1 FROM work_orders w WHERE w.id = $2 AND w.held_deleted_at IS NULL AND ${TECH_SEES}`, [me.toLowerCase(), id])
    : await q("SELECT 1 FROM work_orders w WHERE w.id = $1 AND w.held_deleted_at IS NULL", [id]);
  if (!r) throw new UserError("That work order doesn't exist", 404);
  return role;
}

/** Refuses changes to a finished or cancelled job. */
export async function assertOpen(id: string): Promise<{ number: string; status: Status; desk_ticket: string | null }> {
  const [w] = await q<{ number: string; status: Status; desk_ticket: string | null }>("SELECT number, status, desk_ticket FROM work_orders WHERE id = $1", [id]);
  if (w.status === "completed" || w.status === "cancelled") throw new UserError(`This work order is ${w.status === "completed" ? "complete" : "cancelled"}`, 409);
  return w;
}

export type ListFilter = { status?: string; q?: string; customerId?: string; assetId?: string; open?: boolean };

export async function listWorkOrders(me: string, f: ListFilter = {}): Promise<WorkOrder[]> {
  const role = await requireStaff(me);
  const params: unknown[] = [];
  const where = ["w.held_deleted_at IS NULL"];
  if (role === "technician") {
    params.push(me.toLowerCase());
    where.push(TECH_SEES); // uses $1
  }
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`w.status = $${params.length}`);
  } else if (f.open) where.push("w.status NOT IN ('completed', 'cancelled')");
  if (f.customerId && uuidish(f.customerId)) {
    params.push(f.customerId);
    where.push(`w.customer_id = $${params.length}`);
  }
  if (f.assetId && uuidish(f.assetId)) {
    params.push(f.assetId);
    where.push(`w.asset_id = $${params.length}`);
  }
  const s = text(f.q, 200);
  if (s) {
    params.push(`%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const n = params.length;
    where.push(`(w.number ILIKE $${n} OR w.title ILIKE $${n} OR c.name ILIKE $${n} OR w.address ILIKE $${n} OR COALESCE(w.desk_ticket, '') ILIKE $${n})`);
  }
  const rows = await q(
    `SELECT ${WO_COLS} FROM ${WO_FROM} WHERE ${where.join(" AND ")}
     ORDER BY CASE w.status WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 3 ELSE 1 END,
       CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.due_day NULLS LAST, w.created_at DESC
     LIMIT 500`,
    params,
  );
  return rows.map(toWorkOrder);
}

export async function getWorkOrder(me: string, id: string): Promise<WorkOrderDetail> {
  const myRole = await access(me, id);
  const [r] = await q(`SELECT ${WO_COLS}, w.signature FROM ${WO_FROM} WHERE w.id = $1`, [id]);
  const wo = toWorkOrder(r);
  const [bookings, checklist, notes, files, labor, parts] = await Promise.all([
    q("SELECT * FROM bookings WHERE work_order_id = $1 ORDER BY starts_at", [id]),
    q("SELECT id, title, done_by, done_at FROM checklist WHERE work_order_id = $1 ORDER BY position, title", [id]),
    q("SELECT id, author, body, event, created_at FROM notes WHERE work_order_id = $1 AND held_deleted_at IS NULL ORDER BY created_at", [id]),
    q("SELECT id, name, type, size, added_by, added_at FROM files WHERE work_order_id = $1 AND held_deleted_at IS NULL ORDER BY added_at", [id]),
    q("SELECT id, technician, to_char(day, 'YYYY-MM-DD') AS day, minutes, rate_cents, notes FROM labor WHERE work_order_id = $1 ORDER BY day, created_at", [id]),
    q("SELECT * FROM parts WHERE work_order_id = $1 ORDER BY id", [id]),
  ]);
  let asset: Asset | null = null;
  if (wo.assetId) asset = await getAsset(me, wo.assetId).catch(() => null);
  return {
    ...wo,
    asset,
    signature: (r.signature as string) ?? null,
    myRole,
    bookings: bookings.map(toBooking),
    checklist: checklist.map((c) => ({ id: c.id as string, title: c.title as string, doneBy: (c.done_by as string) ?? null, doneAt: iso(c.done_at) })),
    notes: notes.map((n) => ({ id: n.id as string, author: n.author as string, body: n.body as string, event: n.event as boolean, at: iso(n.created_at)! })),
    files: files.map((f) => ({ id: f.id as string, name: f.name as string, type: f.type as string, size: f.size as number, addedBy: f.added_by as string, at: iso(f.added_at)! })),
    labor: labor.map((l) => ({ id: l.id as string, technician: l.technician as string, day: l.day as string, minutes: l.minutes as number, rateCents: Number(l.rate_cents), notes: l.notes as string })),
    parts: parts.map((p) => ({
      id: String(p.id), sku: p.sku as string, name: p.name as string, unit: p.unit as string, qty: Number(p.qty), unitPriceCents: Number(p.unit_price_cents),
      syncStatus: p.sync_status as Part["syncStatus"], syncError: p.sync_error as string, addedBy: p.added_by as string, at: iso(p.added_at)!,
    })),
  };
}

function pick<T extends string>(v: unknown, list: readonly T[], what: string, fallback?: T): T {
  if ((v === undefined || v === null || v === "") && fallback) return fallback;
  if (!list.includes(v as T)) throw new UserError(`Pick a ${what}: ${list.join(", ")}`);
  return v as T;
}

function dueDay(v: unknown): string | null {
  const s = text(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError("Due date must be a date");
  return s;
}

/** Adds a line to the job's timeline. */
export async function event(tq: Tq | typeof q, workOrderId: string, author: string, body: string): Promise<void> {
  await tq("INSERT INTO notes (work_order_id, author, body, event) VALUES ($1, $2, $3, true)", [workOrderId, author, text(body, 2000)]);
}

/** The default checklist for each kind of job; dispatchers and technicians edit it per job. */
const STARTER: Record<string, string[]> = {
  repair: ["Confirm the fault with the customer", "Diagnose and fix", "Test the equipment", "Walk the customer through the fix"],
  install: ["Check the site is ready", "Install the equipment", "Commission and test", "Show the customer how to use it"],
  maintenance: ["Inspect the equipment", "Replace wear parts and filters", "Clean and lubricate", "Record readings"],
  inspection: ["Inspect against the checklist", "Photograph any defects", "Record findings"],
};

export async function createWorkOrder(me: string, b: Record<string, unknown>): Promise<WorkOrderDetail> {
  await requireDispatcher(me);
  const id = await tx((tq) => insertWorkOrder(tq, me, b));
  return getWorkOrder(me, id);
}

export async function insertWorkOrder(tq: Tq, me: string, b: Record<string, unknown>): Promise<string> {
  const customerId = String(b.customerId ?? "");
  if (!uuidish(customerId)) throw new UserError("Pick a customer");
  const [c] = await tq<{ address: string; name: string; phone: string }>("SELECT address, name, phone FROM customers WHERE id = $1 AND held_deleted_at IS NULL", [customerId]);
  if (!c) throw new UserError("That customer doesn't exist", 404);
  let assetId: string | null = null;
  if (b.assetId) {
    if (!uuidish(b.assetId)) throw new UserError("That asset doesn't exist", 404);
    const [a] = await tq("SELECT 1 FROM assets WHERE id = $1 AND customer_id = $2 AND held_deleted_at IS NULL", [b.assetId, customerId]);
    if (!a) throw new UserError("That asset isn't one of this customer's", 400);
    assetId = b.assetId as string;
  }
  const title = text(b.title, 300);
  if (!title) throw new UserError("Say what the job is");
  const kind = pick(b.kind, KINDS, "kind of job", "repair");
  const est = minutes(b.estimateHours ?? "", "Estimate") || 60;
  if (est > 14400) throw new UserError("Estimate can be at most 240 hours");
  const [n] = await tq<{ n: string }>("SELECT nextval('work_order_seq') AS n");
  const number = `WO-${String(n.n).padStart(5, "0")}`;
  const [r] = await tq<{ id: string }>(
    `INSERT INTO work_orders (number, customer_id, asset_id, title, description, kind, priority, skill, address, contact_name, contact_phone,
       due_day, estimate_minutes, billable, desk_ticket, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [
      number, customerId, assetId, title, text(b.description, 8000), kind, pick(b.priority, PRIORITIES, "priority", "normal"),
      text(b.skill, 60).toLowerCase(), text(b.address, 500) || c.address, text(b.contactName, 200) || c.name,
      text(b.contactPhone, 60) || c.phone, dueDay(b.dueDay), est, b.billable !== false, text(b.deskTicket, 40) || null, me,
    ],
  );
  const steps = STARTER[kind];
  for (let i = 0; i < steps.length; i++) await tq("INSERT INTO checklist (work_order_id, title, position) VALUES ($1, $2, $3)", [r.id, steps[i], i]);
  await event(tq, r.id, me, `Created ${number}`);
  return r.id;
}

export async function updateWorkOrder(me: string, id: string, b: Record<string, unknown>): Promise<WorkOrderDetail> {
  await requireDispatcher(me);
  await access(me, id);
  const [w] = await q<Row>("SELECT * FROM work_orders WHERE id = $1", [id]);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (b.title !== undefined) {
    const t = text(b.title, 300);
    if (!t) throw new UserError("Say what the job is");
    set("title", t);
  }
  if (b.description !== undefined) set("description", text(b.description, 8000));
  if (b.kind !== undefined) set("kind", pick(b.kind, KINDS, "kind of job"));
  if (b.priority !== undefined) set("priority", pick(b.priority, PRIORITIES, "priority"));
  if (b.skill !== undefined) set("skill", text(b.skill, 60).toLowerCase());
  if (b.address !== undefined) set("address", text(b.address, 500));
  if (b.contactName !== undefined) set("contact_name", text(b.contactName, 200));
  if (b.contactPhone !== undefined) set("contact_phone", text(b.contactPhone, 60));
  if (b.dueDay !== undefined) set("due_day", dueDay(b.dueDay));
  if (b.estimateHours !== undefined) {
    const est = minutes(b.estimateHours, "Estimate");
    if (est < 1 || est > 14400) throw new UserError("Estimate must be between a minute and 240 hours");
    set("estimate_minutes", est);
  }
  if (b.billable !== undefined) set("billable", b.billable === true);
  if (b.assetId !== undefined) {
    if (b.assetId === null || b.assetId === "") set("asset_id", null);
    else {
      if (!uuidish(b.assetId)) throw new UserError("That asset doesn't exist", 404);
      const [a] = await q("SELECT 1 FROM assets WHERE id = $1 AND customer_id = $2 AND held_deleted_at IS NULL", [b.assetId, w.customer_id]);
      if (!a) throw new UserError("That asset isn't one of this customer's", 400);
      set("asset_id", b.assetId);
    }
  }
  if (b.status !== undefined && b.status !== w.status) {
    const status = pick(b.status, STATUSES, "status");
    if (status === "completed") throw new UserError("Use Complete to finish a job, so the resolution is recorded");
    if (w.status === "completed" && w.invoice_status !== "none") throw new UserError("This job has been billed, so it stays complete", 409);
    set("status", status);
    if (w.status === "completed") {
      sets.push("completed_at = NULL", "completed_by = NULL");
    }
  }
  if (!sets.length) return getWorkOrder(me, id);
  await tx(async (tq) => {
    await tq(`UPDATE work_orders SET ${sets.join(", ")}, modified_at = now() WHERE id = $1`, params);
    if (b.status !== undefined && b.status !== w.status) {
      await event(tq, id, me, `Status changed to ${String(b.status).replace("_", " ")}`);
      if (b.status === "cancelled") {
        await tq("UPDATE bookings SET status = 'cancelled', modified_at = now() WHERE work_order_id = $1 AND status IN ('scheduled', 'traveling')", [id]);
      }
    }
  });
  if (b.status === "cancelled" && w.desk_ticket) {
    await noteTicket(id, w.desk_ticket as string, `Field service work order ${w.number} was cancelled.`);
  }
  return getWorkOrder(me, id);
}

/**
 * Deletes a work order that hasn't been worked or billed. Under a legal hold on anyone on it, it is
 * only hidden, so eDiscovery still finds it.
 */
export async function deleteWorkOrder(me: string, id: string): Promise<void> {
  await requireDispatcher(me);
  await access(me, id);
  const [w] = await q<{ status: string; invoice_status: string; created_by: string; worked: boolean }>(
    `SELECT status, invoice_status, created_by,
       EXISTS (SELECT 1 FROM labor l WHERE l.work_order_id = w.id) OR EXISTS (SELECT 1 FROM parts p WHERE p.work_order_id = w.id) AS worked
     FROM work_orders w WHERE id = $1`,
    [id],
  );
  if (w.invoice_status !== "none" || w.worked) throw new UserError("Work has been done on this job, so it stays on record. Cancel it instead.", 409);
  const people = await q<{ e: string }>(
    `SELECT DISTINCT e FROM (SELECT $2::text AS e UNION SELECT technician FROM bookings WHERE work_order_id = $1
       UNION SELECT author FROM notes WHERE work_order_id = $1 UNION SELECT added_by FROM files WHERE work_order_id = $1) x`,
    [id, w.created_by],
  );
  const held = holdChecker();
  for (const p of people) {
    if (await held(p.e)) {
      await q("UPDATE work_orders SET held_deleted_at = now(), status = 'cancelled' WHERE id = $1", [id]);
      await q("UPDATE bookings SET status = 'cancelled' WHERE work_order_id = $1 AND status <> 'done'", [id]);
      return;
    }
  }
  await q("DELETE FROM work_orders WHERE id = $1", [id]);
}

// Checklist

export async function addCheck(me: string, id: string, title: unknown): Promise<void> {
  await access(me, id);
  await assertOpen(id);
  const t = text(title, 300);
  if (!t) throw new UserError("Write the step first");
  await q(
    "INSERT INTO checklist (work_order_id, title, position) SELECT $1, $2, COALESCE(max(position) + 1, 0) FROM checklist WHERE work_order_id = $1",
    [id, t],
  );
}

export async function setCheck(me: string, id: string, checkId: string, done: boolean): Promise<void> {
  await access(me, id);
  await assertOpen(id);
  if (!uuidish(checkId)) throw new UserError("That step doesn't exist", 404);
  const rows = await q(
    `UPDATE checklist SET done_by = CASE WHEN $3 THEN $4 END, done_at = CASE WHEN $3 THEN now() END WHERE id = $1 AND work_order_id = $2 RETURNING id`,
    [checkId, id, done, me],
  );
  if (!rows.length) throw new UserError("That step doesn't exist", 404);
}

export async function removeCheck(me: string, id: string, checkId: string): Promise<void> {
  await access(me, id);
  await assertOpen(id);
  if (!uuidish(checkId)) throw new UserError("That step doesn't exist", 404);
  await q("DELETE FROM checklist WHERE id = $1 AND work_order_id = $2", [checkId, id]);
}

// Notes and files

export async function addNote(me: string, id: string, body: unknown): Promise<void> {
  await access(me, id);
  const t = text(body, 8000);
  if (!t) throw new UserError("Write something first");
  await q("INSERT INTO notes (work_order_id, author, body) VALUES ($1, $2, $3)", [id, me, t]);
  await q("UPDATE work_orders SET modified_at = now() WHERE id = $1", [id]);
}

/** A person removes their own note; under a legal hold it is only hidden. */
export async function deleteNote(me: string, id: string, noteId: string): Promise<void> {
  await access(me, id);
  if (!uuidish(noteId)) throw new UserError("That note doesn't exist", 404);
  const [n] = await q<{ author: string; event: boolean }>("SELECT author, event FROM notes WHERE id = $1 AND work_order_id = $2 AND held_deleted_at IS NULL", [noteId, id]);
  if (!n || n.event) throw new UserError("That note doesn't exist", 404);
  if (n.author !== me) throw new UserError("You can only remove your own notes", 403);
  if (await holdChecker()(me)) await q("UPDATE notes SET held_deleted_at = now() WHERE id = $1", [noteId]);
  else await q("DELETE FROM notes WHERE id = $1", [noteId]);
}

export const MAX_FILE = 15 * 1024 * 1024;

export async function addFile(me: string, id: string, file: { name: string; type: string; data: Buffer }): Promise<FileInfo> {
  await access(me, id);
  if (!file.data.length) throw new UserError("That file is empty");
  if (file.data.length > MAX_FILE) throw new UserError("Files can be up to 15 MB", 413);
  const [r] = await q<Row>(
    "INSERT INTO files (work_order_id, name, type, size, data, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, type, size, added_by, added_at",
    [id, text(file.name, 200) || "file", text(file.type, 120) || "application/octet-stream", file.data.length, file.data, me],
  );
  return { id: r.id as string, name: r.name as string, type: r.type as string, size: r.size as number, addedBy: r.added_by as string, at: iso(r.added_at)! };
}

export async function getFile(me: string, id: string, fileId: string): Promise<{ name: string; type: string; data: Buffer }> {
  await access(me, id);
  if (!uuidish(fileId)) throw new UserError("That file doesn't exist", 404);
  const [f] = await q<{ name: string; type: string; data: Buffer }>(
    "SELECT name, type, data FROM files WHERE id = $1 AND work_order_id = $2 AND held_deleted_at IS NULL",
    [fileId, id],
  );
  if (!f) throw new UserError("That file doesn't exist", 404);
  return f;
}

export async function deleteFile(me: string, id: string, fileId: string): Promise<void> {
  const role = await access(me, id);
  if (!uuidish(fileId)) throw new UserError("That file doesn't exist", 404);
  const [f] = await q<{ added_by: string }>("SELECT added_by FROM files WHERE id = $1 AND work_order_id = $2 AND held_deleted_at IS NULL", [fileId, id]);
  if (!f) throw new UserError("That file doesn't exist", 404);
  if (role !== "dispatcher" && f.added_by !== me) throw new UserError("You can only remove files you added", 403);
  if (await holdChecker()(f.added_by)) await q("UPDATE files SET held_deleted_at = now() WHERE id = $1", [fileId]);
  else await q("DELETE FROM files WHERE id = $1", [fileId]);
}

// Labor corrections (dispatchers, before billing)

export async function saveLabor(me: string, id: string, laborId: string | null, b: Record<string, unknown>): Promise<void> {
  await requireDispatcher(me);
  await access(me, id);
  const [w] = await q<{ invoice_status: string }>("SELECT invoice_status FROM work_orders WHERE id = $1", [id]);
  if (w.invoice_status !== "none") throw new UserError("This job has been billed", 409);
  if (laborId !== null && b.remove === true) {
    if (!uuidish(laborId)) throw new UserError("That time doesn't exist", 404);
    await q("DELETE FROM labor WHERE id = $1 AND work_order_id = $2", [laborId, id]);
    return;
  }
  const mins = minutes(b.hours, "Hours");
  if (mins < 1 || mins > 1440) throw new UserError("Hours must be between a minute and 24 hours");
  const rate = b.rate === undefined || b.rate === "" ? null : Math.round(Number(String(b.rate).replace(/[$,\s]/g, "")) * 100);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new UserError("Rate must be a positive number");
  if (laborId === null) {
    const tech = text(b.technician, 200).toLowerCase();
    if (!tech) throw new UserError("Pick who did the work");
    const d = dueDay(b.day) ?? new Date().toISOString().slice(0, 10);
    await q("INSERT INTO labor (work_order_id, technician, day, minutes, rate_cents, notes) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, tech, d, mins, rate ?? (await rateFor(tech)), text(b.notes, 500),
    ]);
  } else {
    if (!uuidish(laborId)) throw new UserError("That time doesn't exist", 404);
    const rows = await q(
      "UPDATE labor SET minutes = $3, rate_cents = COALESCE($4, rate_cents), notes = COALESCE($5, notes) WHERE id = $1 AND work_order_id = $2 RETURNING id",
      [laborId, id, mins, rate, b.notes === undefined ? null : text(b.notes, 500)],
    );
    if (!rows.length) throw new UserError("That time doesn't exist", 404);
  }
}
