import { type Tq, nextNumber, num, numOrNull, q, tx } from "./db";
import {
  type PlanBom, type PlanItem, type Receipt, type Requirement, PlanError, componentQty, explode, lowLevelCodes, operationMinutes, rollUpCost, runMrp,
} from "./plan";
import { getItem, moveStock } from "./stock";
import { UserError, need, number, oneOf, optDate, optEmail, round, text, today } from "./util";

// ---------------------------------------------------------------- work centers

export type WorkCenter = { id: number; code: string; name: string; ratePerHour: number; hoursPerDay: number; active: boolean };

const toWc = (r: Record<string, unknown>): WorkCenter => ({
  id: Number(r.id),
  code: String(r.code),
  name: String(r.name),
  ratePerHour: num(r.rate_per_hour),
  hoursPerDay: num(r.hours_per_day),
  active: Boolean(r.active),
});

export async function listWorkCenters(): Promise<WorkCenter[]> {
  return (await q("SELECT * FROM work_centers ORDER BY active DESC, lower(code)")).map(toWc);
}

function wcFields(b: Record<string, unknown>) {
  return {
    code: need(b.code, "a code", 32),
    name: need(b.name, "a name"),
    rate: number(b.ratePerHour, "rate per hour", { min: 0, fallback: 0 }),
    hours: number(b.hoursPerDay, "hours per day", { min: 0, max: 24, fallback: 8 }),
  };
}

export async function saveWorkCenter(id: number | null, b: Record<string, unknown>): Promise<WorkCenter> {
  const f = wcFields(b);
  const active = b.active === undefined ? true : Boolean(b.active);
  const rows = id
    ? await q("UPDATE work_centers SET code = $2, name = $3, rate_per_hour = $4, hours_per_day = $5, active = $6 WHERE id = $1 RETURNING *", [id, f.code, f.name, f.rate, f.hours, active])
    : await q("INSERT INTO work_centers (code, name, rate_per_hour, hours_per_day) VALUES ($1, $2, $3, $4) RETURNING *", [f.code, f.name, f.rate, f.hours]);
  if (!rows.length) throw new UserError("Work center not found", 404);
  return toWc(rows[0]);
}

// ---------------------------------------------------------------- bills of materials

export type BomLine = { id?: number; componentId: number; sku?: string; name?: string; uom?: string; qty: number; scrapPct: number; unitCost?: number };
export type BomOperation = { id?: number; seq: number; name: string; workCenterId: number; workCenter?: string; setupMinutes: number; runMinutes: number };
export type Bom = {
  id: number;
  itemId: number;
  sku: string;
  name: string;
  version: number;
  outputQty: number;
  status: "draft" | "active" | "obsolete";
  notes: string;
  createdBy: string;
  updatedAt: string;
  lines: BomLine[];
  operations: BomOperation[];
};
export type BomSummary = Omit<Bom, "lines" | "operations"> & { lineCount: number };

export async function listBoms(opts: { itemId?: number; q?: string } = {}): Promise<BomSummary[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.itemId) {
    params.push(opts.itemId);
    where.push(`b.item_id = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }
  const rows = await q(
    `SELECT b.*, i.sku, i.name, (SELECT count(*) FROM bom_lines l WHERE l.bom_id = b.id)::int AS line_count
     FROM boms b JOIN items i ON i.id = b.item_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY lower(i.sku), b.version DESC LIMIT 500`,
    params,
  );
  return rows.map((r) => ({ ...bomHead(r), lineCount: Number(r.line_count) }));
}

function bomHead(r: Record<string, unknown>): Omit<Bom, "lines" | "operations"> {
  return {
    id: Number(r.id),
    itemId: Number(r.item_id),
    sku: String(r.sku),
    name: String(r.name),
    version: Number(r.version),
    outputQty: num(r.output_qty),
    status: r.status as Bom["status"],
    notes: String(r.notes ?? ""),
    createdBy: String(r.created_by ?? ""),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

export async function getBom(id: number): Promise<Bom> {
  const [h] = await q("SELECT b.*, i.sku, i.name FROM boms b JOIN items i ON i.id = b.item_id WHERE b.id = $1", [id]);
  if (!h) throw new UserError("Bill of materials not found", 404);
  const lines = await q(
    `SELECT l.*, i.sku, i.name, i.uom, i.unit_cost FROM bom_lines l JOIN items i ON i.id = l.component_id WHERE l.bom_id = $1 ORDER BY l.position, l.id`,
    [id],
  );
  const ops = await q(
    `SELECT o.*, w.code AS wc FROM bom_operations o JOIN work_centers w ON w.id = o.work_center_id WHERE o.bom_id = $1 ORDER BY o.seq, o.id`,
    [id],
  );
  return {
    ...bomHead(h),
    lines: lines.map((l) => ({
      id: Number(l.id), componentId: Number(l.component_id), sku: String(l.sku), name: String(l.name), uom: String(l.uom),
      qty: num(l.qty), scrapPct: num(l.scrap_pct), unitCost: num(l.unit_cost),
    })),
    operations: ops.map((o) => ({
      id: Number(o.id), seq: Number(o.seq), name: String(o.name), workCenterId: Number(o.work_center_id), workCenter: String(o.wc),
      setupMinutes: num(o.setup_minutes), runMinutes: num(o.run_minutes),
    })),
  };
}

function readLines(v: unknown): BomLine[] {
  if (!Array.isArray(v)) return [];
  return v.map((l: Record<string, unknown>, i) => ({
    componentId: Math.round(number(l.componentId, `the component on line ${i + 1}`, { above: 0 })),
    qty: number(l.qty, `the quantity on line ${i + 1}`, { above: 0 }),
    scrapPct: number(l.scrapPct, `scrap on line ${i + 1}`, { min: 0, max: 99, fallback: 0 }),
  }));
}

function readOperations(v: unknown): BomOperation[] {
  if (!Array.isArray(v)) return [];
  return v.map((o: Record<string, unknown>, i) => ({
    seq: Math.round(number(o.seq, `the step number of operation ${i + 1}`, { min: 0, fallback: (i + 1) * 10 })),
    name: need(o.name, `a name for operation ${i + 1}`),
    workCenterId: Math.round(number(o.workCenterId, `the work center for operation ${i + 1}`, { above: 0 })),
    setupMinutes: number(o.setupMinutes, `setup minutes for operation ${i + 1}`, { min: 0, fallback: 0 }),
    runMinutes: number(o.runMinutes, `run minutes for operation ${i + 1}`, { min: 0, fallback: 0 }),
  }));
}

/** Every active bill, keyed by the item it makes, for planning and costing. */
async function activeBoms(tq: Tq = (t, p) => q(t, p)): Promise<Map<number, PlanBom>> {
  const heads = await tq<{ id: string; item_id: string; output_qty: string }>("SELECT id, item_id, output_qty FROM boms WHERE status = 'active'");
  const lines = await tq<{ bom_id: string; component_id: string; qty: string; scrap_pct: string }>(
    "SELECT l.bom_id, l.component_id, l.qty, l.scrap_pct FROM bom_lines l JOIN boms b ON b.id = l.bom_id WHERE b.status = 'active'",
  );
  const ops = await tq<{ bom_id: string; work_center_id: string; setup_minutes: string; run_minutes: string }>(
    "SELECT o.bom_id, o.work_center_id, o.setup_minutes, o.run_minutes FROM bom_operations o JOIN boms b ON b.id = o.bom_id WHERE b.status = 'active'",
  );
  const byBom = new Map<string, PlanBom>();
  const out = new Map<number, PlanBom>();
  for (const h of heads) {
    const b: PlanBom = { itemId: Number(h.item_id), outputQty: num(h.output_qty), lines: [], operations: [] };
    byBom.set(String(h.id), b);
    out.set(b.itemId, b);
  }
  for (const l of lines) byBom.get(String(l.bom_id))?.lines.push({ componentId: Number(l.component_id), qty: num(l.qty), scrapPct: num(l.scrap_pct) });
  for (const o of ops) byBom.get(String(o.bom_id))?.operations.push({ workCenterId: Number(o.work_center_id), setupMinutes: num(o.setup_minutes), runMinutes: num(o.run_minutes) });
  return out;
}

/** Refuses a bill whose components lead back to the item it makes. */
async function checkNoLoop(tq: Tq, itemId: number, lines: BomLine[]) {
  const boms = await activeBoms(tq);
  boms.set(itemId, { itemId, outputQty: 1, lines: lines.map((l) => ({ ...l })), operations: [] });
  try {
    lowLevelCodes([itemId], boms);
  } catch (e) {
    if (e instanceof PlanError) throw new UserError("That bill of materials would contain its own item");
    throw e;
  }
}

/** A new bill, or a new draft version of an item's bill. */
export async function saveBom(id: number | null, b: Record<string, unknown>, by: string): Promise<Bom> {
  const lines = readLines(b.lines);
  const ops = readOperations(b.operations);
  const outputQty = number(b.outputQty, "output quantity", { above: 0, fallback: 1 });
  const notes = text(b.notes, 4000);
  const bomId = await tx(async (tq) => {
    let target = id;
    let itemId: number;
    if (target) {
      const [h] = await tq<{ item_id: string; status: string }>("SELECT item_id, status FROM boms WHERE id = $1 FOR UPDATE", [target]);
      if (!h) throw new UserError("Bill of materials not found", 404);
      if (h.status !== "draft") throw new UserError("Only a draft can be changed. Copy it to a new version first.");
      itemId = Number(h.item_id);
    } else {
      itemId = Math.round(number(b.itemId, "the item this bill makes", { above: 0 }));
    }
    const [it] = await tq<{ source: string }>("SELECT source FROM items WHERE id = $1", [itemId]);
    if (!it) throw new UserError("Item not found", 404);
    if (lines.some((l) => l.componentId === itemId)) throw new UserError("An item can't be a component of itself");
    if (new Set(lines.map((l) => l.componentId)).size !== lines.length) throw new UserError("Each component can appear once; add the quantities together");
    if (lines.length) {
      const found = await tq<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE id = ANY($1::bigint[])", [lines.map((l) => l.componentId)]);
      if (found[0].n !== lines.length) throw new UserError("One of the components isn't an item here");
    }
    if (ops.length) {
      const found = await tq<{ n: number }>("SELECT count(DISTINCT id)::int AS n FROM work_centers WHERE id = ANY($1::bigint[])", [ops.map((o) => o.workCenterId)]);
      if (found[0].n !== new Set(ops.map((o) => o.workCenterId)).size) throw new UserError("One of the operations uses a work center that isn't here");
    }
    if (target) {
      await tq("UPDATE boms SET output_qty = $2, notes = $3, updated_at = now() WHERE id = $1", [target, outputQty, notes]);
      await tq("DELETE FROM bom_lines WHERE bom_id = $1", [target]);
      await tq("DELETE FROM bom_operations WHERE bom_id = $1", [target]);
    } else {
      const [v] = await tq<{ v: number }>("SELECT COALESCE(max(version), 0)::int + 1 AS v FROM boms WHERE item_id = $1", [itemId]);
      const [r] = await tq<{ id: string }>(
        "INSERT INTO boms (item_id, version, output_qty, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [itemId, v.v, outputQty, notes, by],
      );
      target = Number(r.id);
      // Something you build from parts is a made item from now on.
      if (it.source !== "make") await tq("UPDATE items SET source = 'make', updated_at = now() WHERE id = $1", [itemId]);
    }
    for (const [i, l] of lines.entries()) {
      await tq("INSERT INTO bom_lines (bom_id, component_id, qty, scrap_pct, position) VALUES ($1, $2, $3, $4, $5)", [target, l.componentId, l.qty, l.scrapPct, i]);
    }
    for (const o of ops) {
      await tq(
        "INSERT INTO bom_operations (bom_id, seq, name, work_center_id, setup_minutes, run_minutes) VALUES ($1, $2, $3, $4, $5, $6)",
        [target, o.seq, o.name, o.workCenterId, o.setupMinutes, o.runMinutes],
      );
    }
    return target;
  });
  return getBom(bomId);
}

/** Copies a bill into a new draft version of the same item. */
export async function copyBom(id: number, by: string): Promise<Bom> {
  const src = await getBom(id);
  const [v] = await q<{ v: number }>("SELECT COALESCE(max(version), 0)::int + 1 AS v FROM boms WHERE item_id = $1", [src.itemId]);
  const newId = await tx(async (tq) => {
    const [r] = await tq<{ id: string }>(
      "INSERT INTO boms (item_id, version, output_qty, notes, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [src.itemId, v.v, src.outputQty, src.notes, by],
    );
    await tq("INSERT INTO bom_lines (bom_id, component_id, qty, scrap_pct, position) SELECT $1, component_id, qty, scrap_pct, position FROM bom_lines WHERE bom_id = $2", [r.id, id]);
    await tq("INSERT INTO bom_operations (bom_id, seq, name, work_center_id, setup_minutes, run_minutes) SELECT $1, seq, name, work_center_id, setup_minutes, run_minutes FROM bom_operations WHERE bom_id = $2", [r.id, id]);
    return Number(r.id);
  });
  return getBom(newId);
}

/** Makes this version the one used to build and plan; the version before it becomes obsolete. */
export async function setBomStatus(id: number, status: unknown): Promise<Bom> {
  const s = oneOf(status, ["draft", "active", "obsolete"] as const, "status");
  await tx(async (tq) => {
    const [h] = await tq<{ item_id: string; status: string }>("SELECT item_id, status FROM boms WHERE id = $1 FOR UPDATE", [id]);
    if (!h) throw new UserError("Bill of materials not found", 404);
    if (s === "draft" && h.status !== "draft") throw new UserError("A bill that has been used can't go back to draft. Copy it instead.");
    if (s === "active") {
      const lines = await tq<{ component_id: string; qty: string; scrap_pct: string }>("SELECT component_id, qty, scrap_pct FROM bom_lines WHERE bom_id = $1", [id]);
      if (!lines.length) throw new UserError("Add at least one component before making this bill active");
      await checkNoLoop(tq, Number(h.item_id), lines.map((l) => ({ componentId: Number(l.component_id), qty: num(l.qty), scrapPct: num(l.scrap_pct) })));
      await tq("UPDATE boms SET status = 'obsolete', updated_at = now() WHERE item_id = $1 AND status = 'active' AND id <> $2", [h.item_id, id]);
    }
    await tq("UPDATE boms SET status = $2, updated_at = now() WHERE id = $1", [id, s]);
  });
  return getBom(id);
}

export async function deleteBom(id: number): Promise<void> {
  const [h] = await q<{ status: string; used: boolean }>(
    "SELECT status, EXISTS (SELECT 1 FROM work_orders w WHERE w.bom_id = b.id) AS used FROM boms b WHERE id = $1",
    [id],
  );
  if (!h) throw new UserError("Bill of materials not found", 404);
  if (h.status !== "draft" || h.used) throw new UserError("Only an unused draft can be deleted. Mark it obsolete instead.");
  await q("DELETE FROM boms WHERE id = $1", [id]);
}

async function planData(): Promise<{ items: Map<number, PlanItem & { name: string; uom: string }>; boms: Map<number, PlanBom>; rates: Map<number, number> }> {
  const rows = await q("SELECT * FROM items WHERE active");
  const items = new Map(rows.map((r) => [Number(r.id), {
    id: Number(r.id), sku: String(r.sku), name: String(r.name), uom: String(r.uom), source: r.source as PlanItem["source"], onHand: num(r.on_hand),
    safetyStock: num(r.safety_stock), reorderPoint: num(r.reorder_point), lotSize: num(r.lot_size), leadDays: Number(r.lead_days), unitCost: num(r.unit_cost),
  }]));
  const rates = new Map((await q("SELECT id, rate_per_hour FROM work_centers")).map((r) => [Number(r.id), num(r.rate_per_hour)]));
  return { items, boms: await activeBoms(), rates };
}

export type Costing = {
  itemId: number;
  material: number;
  labor: number;
  total: number;
  /** Everything needed for the quantity asked, all levels down, with what is on hand. */
  components: { itemId: number; sku: string; name: string; uom: string; level: number; qty: number; onHand: number; short: number }[];
};

/** Standard cost and the full parts list for `qty` of an item, using the active bills. */
export async function costing(itemId: number, qty = 1): Promise<Costing> {
  const { items, boms, rates } = await planData();
  if (!items.has(itemId)) throw new UserError("Item not found", 404);
  const c = rollUpCost(itemId, items, boms, rates);
  return {
    itemId,
    material: round(c.material),
    labor: round(c.labor),
    total: round(c.total),
    components: explode(itemId, qty, boms).map((e) => {
      const it = items.get(e.itemId);
      const onHand = it?.onHand ?? 0;
      return { itemId: e.itemId, sku: it?.sku ?? "?", name: it?.name ?? "", uom: it?.uom ?? "", level: e.level, qty: round(e.qty), onHand, short: round(Math.max(0, e.qty - onHand)) };
    }),
  };
}

// ---------------------------------------------------------------- work orders

export const WO_STATUSES = ["planned", "released", "in_progress", "done", "cancelled"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

export type WorkOrder = {
  id: number;
  number: string;
  itemId: number;
  sku: string;
  name: string;
  uom: string;
  bomId: number | null;
  bomVersion: number | null;
  qty: number;
  qtyDone: number;
  status: WoStatus;
  startDate: string | null;
  dueDate: string | null;
  assignee: string;
  notes: string;
  materialCost: number;
  laborCost: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  late: boolean;
};

export type WoMaterial = { id: number; itemId: number; sku: string; name: string; uom: string; required: number; issued: number; onHand: number; costIssued: number };
export type WoOperation = { id: number; seq: number; name: string; workCenterId: number; workCenter: string; plannedMinutes: number; actualMinutes: number | null; ratePerHour: number; status: string; doneBy: string; doneAt: string | null };
export type WorkOrderDetail = WorkOrder & { materials: WoMaterial[]; operations: WoOperation[] };

const WO_SELECT = `SELECT w.*, i.sku, i.name, i.uom, b.version AS bom_version FROM work_orders w JOIN items i ON i.id = w.item_id LEFT JOIN boms b ON b.id = w.bom_id`;

function toWo(r: Record<string, unknown>): WorkOrder {
  const due = (r.due_date as string | null) ?? null;
  const status = r.status as WoStatus;
  return {
    id: Number(r.id),
    number: String(r.number),
    itemId: Number(r.item_id),
    sku: String(r.sku),
    name: String(r.name),
    uom: String(r.uom),
    bomId: r.bom_id === null ? null : Number(r.bom_id),
    bomVersion: r.bom_version === null || r.bom_version === undefined ? null : Number(r.bom_version),
    qty: num(r.qty),
    qtyDone: num(r.qty_done),
    status,
    startDate: (r.start_date as string | null) ?? null,
    dueDate: due,
    assignee: String(r.assignee ?? ""),
    notes: String(r.notes ?? ""),
    materialCost: num(r.material_cost),
    laborCost: num(r.labor_cost),
    createdBy: String(r.created_by ?? ""),
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    late: !!due && due < today() && status !== "done" && status !== "cancelled",
  };
}

export async function listWorkOrders(opts: { status?: string; q?: string; mine?: string } = {}): Promise<WorkOrder[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.status === "open") where.push("w.status IN ('planned','released','in_progress')");
  else if (opts.status && (WO_STATUSES as readonly string[]).includes(opts.status)) {
    params.push(opts.status);
    where.push(`w.status = $${params.length}`);
  }
  if (opts.mine) {
    params.push(opts.mine.toLowerCase());
    where.push(`lower(w.assignee) = $${params.length}`);
  }
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(w.number ILIKE $${params.length} OR i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length} OR w.notes ILIKE $${params.length})`);
  }
  const rows = await q(`${WO_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY w.due_date NULLS LAST, w.id DESC LIMIT 500`, params);
  return rows.map(toWo);
}

export async function getWorkOrder(id: number): Promise<WorkOrderDetail> {
  const [r] = await q(`${WO_SELECT} WHERE w.id = $1`, [id]);
  if (!r) throw new UserError("Work order not found", 404);
  const mats = await q(
    "SELECT m.*, i.sku, i.name, i.uom, i.on_hand FROM wo_materials m JOIN items i ON i.id = m.item_id WHERE m.wo_id = $1 ORDER BY m.id",
    [id],
  );
  const ops = await q("SELECT o.*, c.code FROM wo_operations o JOIN work_centers c ON c.id = o.work_center_id WHERE o.wo_id = $1 ORDER BY o.seq, o.id", [id]);
  return {
    ...toWo(r),
    materials: mats.map((m) => ({
      id: Number(m.id), itemId: Number(m.item_id), sku: String(m.sku), name: String(m.name), uom: String(m.uom),
      required: num(m.qty_required), issued: num(m.qty_issued), onHand: num(m.on_hand), costIssued: num(m.cost_issued),
    })),
    operations: ops.map((o) => ({
      id: Number(o.id), seq: Number(o.seq), name: String(o.name), workCenterId: Number(o.work_center_id), workCenter: String(o.code),
      plannedMinutes: num(o.planned_minutes), actualMinutes: numOrNull(o.actual_minutes), ratePerHour: num(o.rate_per_hour),
      status: String(o.status), doneBy: String(o.done_by ?? ""), doneAt: o.done_at ? new Date(o.done_at as string).toISOString() : null,
    })),
  };
}

/** A new planned work order, built from the item's active bill. */
export async function createWorkOrder(b: Record<string, unknown>, by: string, tqIn?: Tq): Promise<number> {
  const itemId = Math.round(number(b.itemId, "the item to make", { above: 0 }));
  const qty = number(b.qty, "a quantity", { above: 0 });
  const due = optDate(b.dueDate, "due date");
  let start = optDate(b.startDate, "start date");
  const run = async (tq: Tq) => {
    const [it] = await tq<{ lead_days: number }>("SELECT lead_days FROM items WHERE id = $1", [itemId]);
    if (!it) throw new UserError("Item not found", 404);
    const [bom] = await tq<{ id: string }>("SELECT id FROM boms WHERE item_id = $1 AND status = 'active'", [itemId]);
    if (!bom) throw new UserError("This item has no active bill of materials yet");
    if (!start && due) {
      const d = new Date(`${due}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - Number(it.lead_days));
      start = d.toISOString().slice(0, 10);
      if (start < today()) start = today();
    }
    const number_ = await nextNumber(tq, "wo", "WO");
    const [r] = await tq<{ id: string }>(
      `INSERT INTO work_orders (number, item_id, bom_id, qty, start_date, due_date, assignee, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [number_, itemId, bom.id, qty, start, due, optEmail(b.assignee, "the assignee's email"), text(b.notes, 4000), by],
    );
    return Number(r.id);
  };
  return tqIn ? run(tqIn) : tx(run);
}

export async function updateWorkOrder(id: number, b: Record<string, unknown>): Promise<WorkOrderDetail> {
  await tx(async (tq) => {
    const [w] = await tq<{ status: string }>("SELECT status FROM work_orders WHERE id = $1 FOR UPDATE", [id]);
    if (!w) throw new UserError("Work order not found", 404);
    if (w.status === "done" || w.status === "cancelled") throw new UserError("This work order is closed");
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if ("qty" in b) {
      if (w.status !== "planned") throw new UserError("The quantity can only change before the order is released");
      set("qty", number(b.qty, "a quantity", { above: 0 }));
    }
    if ("startDate" in b) set("start_date", optDate(b.startDate, "start date"));
    if ("dueDate" in b) set("due_date", optDate(b.dueDate, "due date"));
    if ("assignee" in b) set("assignee", optEmail(b.assignee, "the assignee's email"));
    if ("notes" in b) set("notes", text(b.notes, 4000));
    if (sets.length) await tq(`UPDATE work_orders SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  });
  return getWorkOrder(id);
}

/** Copies the bill's components and routing onto the order at its quantity. */
async function release(tq: Tq, id: number, w: { bom_id: string | null; qty: string }) {
  if (!w.bom_id) throw new UserError("This work order has no bill of materials");
  const [bom] = await tq<{ output_qty: string }>("SELECT output_qty FROM boms WHERE id = $1", [w.bom_id]);
  const head = { outputQty: num(bom.output_qty) };
  const qty = num(w.qty);
  const lines = await tq<{ component_id: string; qty: string; scrap_pct: string }>("SELECT component_id, qty, scrap_pct FROM bom_lines WHERE bom_id = $1 ORDER BY position, id", [w.bom_id]);
  for (const l of lines) {
    const need_ = componentQty({ componentId: Number(l.component_id), qty: num(l.qty), scrapPct: num(l.scrap_pct) }, head, qty);
    await tq("INSERT INTO wo_materials (wo_id, item_id, qty_required) VALUES ($1, $2, $3)", [id, l.component_id, round(need_)]);
  }
  const ops = await tq<{ seq: number; name: string; work_center_id: string; setup_minutes: string; run_minutes: string; rate: string }>(
    "SELECT o.seq, o.name, o.work_center_id, o.setup_minutes, o.run_minutes, c.rate_per_hour AS rate FROM bom_operations o JOIN work_centers c ON c.id = o.work_center_id WHERE o.bom_id = $1 ORDER BY o.seq, o.id",
    [w.bom_id],
  );
  for (const o of ops) {
    const minutes = operationMinutes({ workCenterId: 0, setupMinutes: num(o.setup_minutes), runMinutes: num(o.run_minutes) }, qty);
    await tq(
      "INSERT INTO wo_operations (wo_id, seq, name, work_center_id, planned_minutes, rate_per_hour) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, o.seq, o.name, o.work_center_id, round(minutes, 2), o.rate],
    );
  }
  await tq("UPDATE work_orders SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1", [id]);
}

/** Takes components off the shelf for this order: `qty` of one material, or everything still owed. */
async function issue(tq: Tq, id: number, number_: string, by: string, only?: { materialId: number; qty: number }) {
  const mats = await tq<{ id: string; item_id: string; qty_required: string; qty_issued: string }>(
    "SELECT id, item_id, qty_required, qty_issued FROM wo_materials WHERE wo_id = $1 ORDER BY id FOR UPDATE",
    [id],
  );
  let total = 0;
  for (const m of mats) {
    if (only && Number(m.id) !== only.materialId) continue;
    const owed = round(num(m.qty_required) - num(m.qty_issued));
    const qty = only ? only.qty : owed;
    if (qty <= 0) continue;
    const { unitCost } = await moveStock(tq, { itemId: Number(m.item_id), qty: -qty, kind: "issue", ref: number_, note: "Issued to work order", by });
    const cost = round(qty * unitCost);
    total += cost;
    await tq("UPDATE wo_materials SET qty_issued = qty_issued + $2, cost_issued = cost_issued + $3 WHERE id = $1", [m.id, qty, cost]);
  }
  if (only && !mats.some((m) => Number(m.id) === only.materialId)) throw new UserError("That material isn't on this work order", 404);
  if (total) await tq("UPDATE work_orders SET material_cost = material_cost + $2, updated_at = now() WHERE id = $1", [id, total]);
}

/**
 * Moves a work order along: release (copies the bill onto it), start, issue materials, finish an
 * operation, complete (issues what is still owed, books labor at each work center's rate, and
 * receives the finished goods at what they actually cost) or cancel.
 */
export async function actOnWorkOrder(id: number, b: Record<string, unknown>, by: string): Promise<WorkOrderDetail> {
  const action = oneOf(b.action, ["release", "start", "issue", "operation", "complete", "cancel"] as const, "action");
  await tx(async (tq) => {
    const [w] = await tq<{ status: WoStatus; bom_id: string | null; qty: string; number: string; item_id: string; material_cost: string }>(
      "SELECT status, bom_id, qty, number, item_id, material_cost FROM work_orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!w) throw new UserError("Work order not found", 404);
    const closed = w.status === "done" || w.status === "cancelled";
    if (closed) throw new UserError("This work order is closed");
    const begin = () => tq("UPDATE work_orders SET status = 'in_progress', updated_at = now() WHERE id = $1 AND status = 'released'", [id]);

    if (action === "release") {
      if (w.status !== "planned") throw new UserError("This work order is already released");
      await release(tq, id, w);
      return;
    }
    if (action === "cancel") {
      const [issued] = await tq<{ n: number }>("SELECT count(*)::int AS n FROM wo_materials WHERE wo_id = $1 AND qty_issued > 0", [id]);
      if (issued.n) throw new UserError("Materials were already issued to this order. Complete it with what was made instead.");
      await tq("UPDATE work_orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      return;
    }
    if (w.status === "planned") throw new UserError("Release the work order first");
    if (action === "start") {
      await begin();
      return;
    }
    if (action === "issue") {
      const materialId = b.materialId === undefined ? undefined : Math.round(number(b.materialId, "the material", { above: 0 }));
      await issue(tq, id, w.number, by, materialId ? { materialId, qty: number(b.qty, "a quantity", { above: 0 }) } : undefined);
      await begin();
      return;
    }
    if (action === "operation") {
      const opId = Math.round(number(b.operationId, "the operation", { above: 0 }));
      const minutes = b.minutes === undefined || b.minutes === "" ? null : number(b.minutes, "minutes", { min: 0 });
      const rows = await tq(
        `UPDATE wo_operations SET status = 'done', actual_minutes = COALESCE($3, planned_minutes), done_by = $4, done_at = now()
         WHERE id = $1 AND wo_id = $2 RETURNING id`,
        [opId, id, minutes, by],
      );
      if (!rows.length) throw new UserError("That operation isn't on this work order", 404);
      await begin();
      return;
    }
    // complete
    const made = number(b.qtyDone, "the quantity made", { above: 0, fallback: num(w.qty) });
    await issue(tq, id, w.number, by);
    await tq(
      "UPDATE wo_operations SET status = 'done', actual_minutes = COALESCE(actual_minutes, planned_minutes), done_by = CASE WHEN done_by = '' THEN $2 ELSE done_by END, done_at = COALESCE(done_at, now()) WHERE wo_id = $1",
      [id, by],
    );
    const [labor] = await tq<{ cost: string }>("SELECT COALESCE(sum(actual_minutes * rate_per_hour / 60), 0) AS cost FROM wo_operations WHERE wo_id = $1", [id]);
    const [mat] = await tq<{ cost: string }>("SELECT material_cost AS cost FROM work_orders WHERE id = $1", [id]);
    const laborCost = round(num(labor.cost));
    const unit = round((num(mat.cost) + laborCost) / made);
    await moveStock(tq, { itemId: Number(w.item_id), qty: made, unitCost: unit, kind: "produce", ref: w.number, note: "Finished goods from work order", by });
    await tq(
      "UPDATE work_orders SET status = 'done', qty_done = $2, labor_cost = $3, completed_at = now(), updated_at = now() WHERE id = $1",
      [id, made, laborCost],
    );
  });
  return getWorkOrder(id);
}

// ---------------------------------------------------------------- demand, MRP and purchase requests

export type Demand = { id: number; itemId: number; sku: string; name: string; qty: number; dueDate: string; reference: string; source: string; open: boolean; createdBy: string };

export async function listDemands(): Promise<Demand[]> {
  const rows = await q("SELECT d.*, i.sku, i.name FROM demands d JOIN items i ON i.id = d.item_id WHERE d.open ORDER BY d.due_date, d.id");
  return rows.map((r) => ({
    id: Number(r.id), itemId: Number(r.item_id), sku: String(r.sku), name: String(r.name), qty: num(r.qty), dueDate: String(r.due_date),
    reference: String(r.reference), source: String(r.source), open: Boolean(r.open), createdBy: String(r.created_by),
  }));
}

export async function addDemand(b: Record<string, unknown>, by: string, source = "manual"): Promise<void> {
  const itemId = Math.round(number(b.itemId, "the item", { above: 0 }));
  const qty = number(b.qty, "a quantity", { above: 0 });
  const due = optDate(b.dueDate, "due date");
  if (!due) throw new UserError("Enter a due date");
  await getItem(itemId);
  await q("INSERT INTO demands (item_id, qty, due_date, reference, source, created_by) VALUES ($1, $2, $3, $4, $5, $6)", [itemId, qty, due, text(b.reference, 120), text(source, 32), by]);
}

/** A demand from another app (a sales order, a store order) by SKU. */
export async function addDemandBySku(b: Record<string, unknown>, source: string): Promise<{ ok: true }> {
  const sku = need(b.sku, "a SKU", 64);
  const [it] = await q<{ id: string }>("SELECT id FROM items WHERE lower(sku) = lower($1)", [sku]);
  if (!it) throw new UserError(`No item with SKU ${sku}`, 404);
  await addDemand({ ...b, itemId: Number(it.id) }, "", source);
  return { ok: true };
}

export async function closeDemand(id: number): Promise<void> {
  await q("UPDATE demands SET open = false WHERE id = $1", [id]);
}

export type PlannedOrderRow = {
  id: number; itemId: number; sku: string; name: string; uom: string; kind: "make" | "buy"; qty: number;
  needDate: string; startDate: string; late: boolean; reason: string; status: string; firmedRef: string;
};

export type MrpState = { runAt: string | null; runBy: string; orders: PlannedOrderRow[] };

export async function mrpState(): Promise<MrpState> {
  const [run] = await q<{ id: string; run_at: Date; run_by: string }>("SELECT id, run_at, run_by FROM mrp_runs ORDER BY id DESC LIMIT 1");
  if (!run) return { runAt: null, runBy: "", orders: [] };
  const rows = await q(
    "SELECT p.*, i.sku, i.name, i.uom FROM planned_orders p JOIN items i ON i.id = p.item_id WHERE p.run_id = $1 ORDER BY p.start_date, p.id",
    [run.id],
  );
  return {
    runAt: new Date(run.run_at).toISOString(),
    runBy: run.run_by,
    orders: rows.map((r) => ({
      id: Number(r.id), itemId: Number(r.item_id), sku: String(r.sku), name: String(r.name), uom: String(r.uom), kind: r.kind as "make" | "buy",
      qty: num(r.qty), needDate: String(r.need_date), startDate: String(r.start_date), late: Boolean(r.late), reason: String(r.reason),
      status: String(r.status), firmedRef: String(r.firmed_ref),
    })),
  };
}

/**
 * Runs MRP over everything open: outside demand and the materials released work orders still
 * need, against stock on hand, open work orders and open purchase requests. The new suggestions
 * replace the last run's; what was already firmed stays as the order it became.
 */
export async function runPlanning(by: string): Promise<MrpState> {
  const { items, boms } = await planData();
  const t = today();
  const requirements: Requirement[] = [];
  for (const d of await q<{ item_id: string; qty: string; due_date: string; reference: string }>("SELECT item_id, qty, due_date, reference FROM demands WHERE open")) {
    requirements.push({ itemId: Number(d.item_id), qty: num(d.qty), date: d.due_date, reason: d.reference || "Demand" });
  }
  const owed = await q<{ item_id: string; owed: string; date: string | null; number: string }>(
    `SELECT m.item_id, m.qty_required - m.qty_issued AS owed, COALESCE(w.start_date, w.due_date) AS date, w.number
     FROM wo_materials m JOIN work_orders w ON w.id = m.wo_id WHERE w.status IN ('released','in_progress') AND m.qty_required > m.qty_issued`,
  );
  for (const o of owed) requirements.push({ itemId: Number(o.item_id), qty: num(o.owed), date: o.date ?? t, reason: `For ${o.number}` });

  const receipts: Receipt[] = [];
  const wos = await q<{ id: string; item_id: string; status: string; qty: string; bom_id: string | null; date: string | null; start: string | null; number: string }>(
    "SELECT id, item_id, status, qty, bom_id, COALESCE(due_date, start_date) AS date, start_date AS start, number FROM work_orders WHERE status IN ('planned','released','in_progress')",
  );
  for (const w of wos) {
    receipts.push({ itemId: Number(w.item_id), qty: num(w.qty), date: w.date ?? t });
    // A planned order hasn't copied its materials yet; its bill says what it will need.
    if (w.status === "planned") {
      const bom = boms.get(Number(w.item_id));
      if (bom) for (const l of bom.lines) requirements.push({ itemId: l.componentId, qty: componentQty(l, bom, num(w.qty)), date: w.start ?? w.date ?? t, reason: `For ${w.number}` });
    }
  }
  for (const p of await q<{ item_id: string; qty: string; need_date: string | null }>("SELECT item_id, qty, need_date FROM purchase_requests WHERE status IN ('open','ordered')")) {
    receipts.push({ itemId: Number(p.item_id), qty: num(p.qty), date: p.need_date ?? t });
  }

  let planned;
  try {
    planned = runMrp({ items: [...items.values()], boms, receipts, requirements: requirements.filter((r) => items.has(r.itemId)), today: t });
  } catch (e) {
    if (e instanceof PlanError) throw new UserError(e.message);
    throw e;
  }
  await tx(async (tq) => {
    await tq("DELETE FROM planned_orders WHERE status = 'suggested'");
    const [run] = await tq<{ id: string }>("INSERT INTO mrp_runs (run_by, orders) VALUES ($1, $2) RETURNING id", [by, planned.length]);
    for (const p of planned) {
      await tq(
        "INSERT INTO planned_orders (run_id, item_id, kind, qty, need_date, start_date, late, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [run.id, p.itemId, p.kind, round(p.qty), p.needDate, p.startDate, p.late, text(p.reason, 200)],
      );
    }
  });
  return mrpState();
}

/** Turns a suggestion into the real thing: a planned work order, or a purchase request. */
export async function firmPlanned(id: number, by: string): Promise<{ ref: string; kind: "make" | "buy"; id: number }> {
  return tx(async (tq) => {
    const [p] = await tq<{ item_id: string; kind: "make" | "buy"; qty: string; need_date: string; start_date: string; status: string }>(
      "SELECT item_id, kind, qty, need_date, start_date, status FROM planned_orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!p) throw new UserError("Planned order not found", 404);
    if (p.status !== "suggested") throw new UserError("This suggestion was already handled");
    let ref: string;
    let made: number;
    if (p.kind === "make") {
      made = await createWorkOrder({ itemId: Number(p.item_id), qty: num(p.qty), dueDate: p.need_date, startDate: p.start_date, notes: "From MRP" }, by, tq);
      const [w] = await tq<{ number: string }>("SELECT number FROM work_orders WHERE id = $1", [made]);
      ref = w.number;
    } else {
      ref = await nextNumber(tq, "pr", "PR");
      const [r] = await tq<{ id: string }>(
        "INSERT INTO purchase_requests (number, item_id, qty, need_date, reference, created_by) VALUES ($1, $2, $3, $4, 'MRP', $5) RETURNING id",
        [ref, p.item_id, p.qty, p.need_date, by],
      );
      made = Number(r.id);
    }
    await tq("UPDATE planned_orders SET status = 'firmed', firmed_ref = $2 WHERE id = $1", [id, ref]);
    return { ref, kind: p.kind, id: made };
  });
}

export async function dismissPlanned(id: number): Promise<void> {
  await q("UPDATE planned_orders SET status = 'dismissed' WHERE id = $1 AND status = 'suggested'", [id]);
}

export type PurchaseRequest = {
  id: number; number: string; itemId: number; sku: string; name: string; uom: string; qty: number; needDate: string | null;
  status: "open" | "ordered" | "received" | "cancelled"; vendor: string; reference: string; createdBy: string; createdAt: string; unitCost: number;
};

export async function listPurchaseRequests(opts: { status?: string } = {}): Promise<PurchaseRequest[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.status === "open") where = "WHERE p.status IN ('open','ordered')";
  else if (opts.status) {
    params.push(opts.status);
    where = "WHERE p.status = $1";
  }
  const rows = await q(`SELECT p.*, i.sku, i.name, i.uom, i.unit_cost FROM purchase_requests p JOIN items i ON i.id = p.item_id ${where} ORDER BY p.need_date NULLS LAST, p.id DESC LIMIT 500`, params);
  return rows.map((r) => ({
    id: Number(r.id), number: String(r.number), itemId: Number(r.item_id), sku: String(r.sku), name: String(r.name), uom: String(r.uom), qty: num(r.qty),
    needDate: (r.need_date as string | null) ?? null, status: r.status as PurchaseRequest["status"], vendor: String(r.vendor), reference: String(r.reference),
    createdBy: String(r.created_by), createdAt: new Date(r.created_at as string).toISOString(), unitCost: num(r.unit_cost),
  }));
}

export async function createPurchaseRequest(b: Record<string, unknown>, by: string): Promise<void> {
  const itemId = Math.round(number(b.itemId, "the item", { above: 0 }));
  const qty = number(b.qty, "a quantity", { above: 0 });
  await getItem(itemId);
  await tx(async (tq) => {
    const ref = await nextNumber(tq, "pr", "PR");
    await tq(
      "INSERT INTO purchase_requests (number, item_id, qty, need_date, vendor, reference, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [ref, itemId, qty, optDate(b.needDate, "need-by date"), text(b.vendor, 200), text(b.reference, 120), by],
    );
  });
}

/** Marks a request ordered, cancels it, or receives it into stock at the price paid. */
export async function actOnPurchaseRequest(id: number, b: Record<string, unknown>, by: string): Promise<void> {
  const action = oneOf(b.action, ["ordered", "receive", "cancel"] as const, "action");
  await tx(async (tq) => {
    const [p] = await tq<{ status: string; item_id: string; qty: string; number: string }>("SELECT status, item_id, qty, number FROM purchase_requests WHERE id = $1 FOR UPDATE", [id]);
    if (!p) throw new UserError("Purchase request not found", 404);
    if (p.status === "received" || p.status === "cancelled") throw new UserError("This request is closed");
    if (action === "ordered") {
      await tq("UPDATE purchase_requests SET status = 'ordered', vendor = COALESCE(NULLIF($2, ''), vendor), reference = COALESCE(NULLIF($3, ''), reference), updated_at = now() WHERE id = $1", [id, text(b.vendor, 200), text(b.reference, 120)]);
    } else if (action === "cancel") {
      await tq("UPDATE purchase_requests SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
    } else {
      const qty = number(b.qty, "the quantity received", { above: 0, fallback: num(p.qty) });
      const unitCost = b.unitCost === undefined || b.unitCost === "" ? undefined : number(b.unitCost, "unit cost", { min: 0 });
      await moveStock(tq, { itemId: Number(p.item_id), qty, unitCost, kind: "receipt", ref: p.number, note: "Received against purchase request", by });
      await tq("UPDATE purchase_requests SET status = 'received', updated_at = now() WHERE id = $1", [id]);
    }
  });
}
