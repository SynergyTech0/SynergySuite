import { booksLinked } from "./books";
import { type Tq, nextNumber, num, numOrNull, q, tx } from "./db";
import { advance, bookValue, dueReason } from "./schedule";
import { moveStock } from "./stock";
import { UserError, need, number, oneOf, optDate, optEmail, optNumber, round, text, today } from "./util";

// ---------------------------------------------------------------- the register

export const ASSET_STATUSES = ["active", "in_repair", "retired", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export type Asset = {
  id: number;
  tag: string;
  name: string;
  category: string;
  location: string;
  make: string;
  model: string;
  serial: string;
  status: AssetStatus;
  parentId: number | null;
  parentTag: string | null;
  assignee: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  salvageValue: number | null;
  usefulLifeMonths: number | null;
  meterUnit: string;
  meterValue: number | null;
  notes: string;
  booksAssetId: string | null;
  booksError: string;
  bookValue: number | null;
  openOrders: number;
  createdAt: string;
  updatedAt: string;
};

const ASSET_SELECT = `SELECT a.*, p.tag AS parent_tag,
  (SELECT count(*)::int FROM maint_orders o WHERE o.asset_id = a.id AND o.status IN ('open','in_progress','on_hold')) AS open_orders
  FROM assets a LEFT JOIN assets p ON p.id = a.parent_id`;

function toAsset(r: Record<string, unknown>): Asset {
  const cost = numOrNull(r.purchase_cost);
  const salvage = numOrNull(r.salvage_value);
  const life = r.useful_life_months === null ? null : Number(r.useful_life_months);
  const purchased = (r.purchase_date as string | null) ?? null;
  return {
    id: Number(r.id),
    tag: String(r.tag),
    name: String(r.name),
    category: String(r.category),
    location: String(r.location),
    make: String(r.make),
    model: String(r.model),
    serial: String(r.serial),
    status: r.status as AssetStatus,
    parentId: r.parent_id === null ? null : Number(r.parent_id),
    parentTag: (r.parent_tag as string | null) ?? null,
    assignee: String(r.assignee),
    purchaseDate: purchased,
    purchaseCost: cost,
    salvageValue: salvage,
    usefulLifeMonths: life,
    meterUnit: String(r.meter_unit),
    meterValue: numOrNull(r.meter_value),
    notes: String(r.notes),
    booksAssetId: (r.books_asset_id as string | null) ?? null,
    booksError: String(r.books_error ?? ""),
    bookValue: bookValue(cost, salvage, life, purchased, today())?.value ?? null,
    openOrders: Number(r.open_orders ?? 0),
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listAssets(opts: { q?: string; status?: string; mine?: string } = {}): Promise<Asset[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.status === "in_service") where.push("a.status IN ('active','in_repair')");
  else if (opts.status && (ASSET_STATUSES as readonly string[]).includes(opts.status)) {
    params.push(opts.status);
    where.push(`a.status = $${params.length}`);
  }
  if (opts.mine) {
    params.push(opts.mine.toLowerCase());
    where.push(`lower(a.assignee) = $${params.length}`);
  }
  if (opts.q) {
    params.push(like(opts.q));
    const p = `$${params.length}`;
    where.push(`(a.tag ILIKE ${p} OR a.name ILIKE ${p} OR a.serial ILIKE ${p} OR a.location ILIKE ${p} OR a.category ILIKE ${p} OR a.model ILIKE ${p})`);
  }
  const rows = await q(`${ASSET_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.tag LIMIT 1000`, params);
  return rows.map(toAsset);
}

/**
 * The asset register for Field Service (/api/svc/assets, Bearer OPS_API_TOKEN), which brings
 * equipment onto a customer by its tag: what the unit is and where, without costs or the books.
 * `tag` finds exactly one; otherwise in-service assets matching `q`.
 */
export async function svcAssets(opts: { q?: string; tag?: string }) {
  let rows: Asset[];
  if (opts.tag) rows = (await q(`${ASSET_SELECT} WHERE lower(a.tag) = lower($1)`, [opts.tag.trim()])).map(toAsset);
  else rows = (await listAssets({ q: opts.q?.trim() || undefined, status: "in_service" })).slice(0, 100);
  return rows.map((a) => ({
    tag: a.tag, name: a.name, category: a.category, location: a.location, make: a.make, model: a.model, serial: a.serial,
    status: a.status, purchaseDate: a.purchaseDate,
  }));
}

export async function getAsset(id: number): Promise<Asset> {
  const [r] = await q(`${ASSET_SELECT} WHERE a.id = $1`, [id]);
  if (!r) throw new UserError("Asset not found", 404);
  return toAsset(r);
}

function assetFields(b: Record<string, unknown>, partial: boolean) {
  const has = (k: string) => !partial || k in b;
  const f: Record<string, unknown> = {};
  if (has("name")) f.name = need(b.name, "a name");
  for (const [k, col, max] of [["category", "category", 80], ["location", "location", 120], ["make", "make", 80], ["model", "model", 80], ["serial", "serial", 120], ["meterUnit", "meter_unit", 16]] as const) {
    if (has(k)) f[col] = text(b[k], max);
  }
  if (has("notes")) f.notes = text(b.notes, 4000);
  if (has("assignee")) f.assignee = optEmail(b.assignee, "the email of the person who has it");
  if (has("purchaseDate")) f.purchase_date = optDate(b.purchaseDate, "purchase date");
  if (has("purchaseCost")) f.purchase_cost = optNumber(b.purchaseCost, "purchase cost", { min: 0 });
  if (has("salvageValue")) f.salvage_value = optNumber(b.salvageValue, "salvage value", { min: 0 });
  if (has("usefulLifeMonths")) {
    const v = optNumber(b.usefulLifeMonths, "useful life", { above: 0, max: 1200 });
    f.useful_life_months = v === null ? null : Math.round(v);
  }
  if (has("parentId")) f.parent_id = b.parentId === null || b.parentId === "" || b.parentId === undefined ? null : Math.round(number(b.parentId, "the parent asset", { above: 0 }));
  if (partial && "status" in b) f.status = oneOf(b.status, ASSET_STATUSES, "status");
  return f;
}

async function checkParent(tq: Tq, id: number | null, parent: unknown) {
  if (parent === null || parent === undefined) return;
  // Walk up from the new parent; meeting this asset again would make a loop.
  let at: number | null = Number(parent);
  for (let i = 0; at !== null && i < 100; i++) {
    if (id !== null && at === id) throw new UserError("An asset can't sit inside itself");
    const [r]: { parent_id: string | null }[] = await tq("SELECT parent_id FROM assets WHERE id = $1", [at]);
    if (!r) throw new UserError("Parent asset not found");
    at = r.parent_id === null ? null : Number(r.parent_id);
  }
}

export async function createAsset(b: Record<string, unknown>, by: string): Promise<Asset> {
  const f = assetFields(b, false);
  const id = await tx(async (tq) => {
    await checkParent(tq, null, f.parent_id);
    let tag = text(b.tag, 40);
    if (!tag) tag = await nextNumber(tq, "asset", "AST");
    const cols = ["tag", "created_by", ...Object.keys(f)];
    const vals = [tag, by, ...Object.values(f)];
    const [r] = await tq<{ id: string }>(`INSERT INTO assets (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals);
    if (f.meter_unit && b.meterValue !== undefined && b.meterValue !== "") await readMeter(tq, Number(r.id), number(b.meterValue, "meter reading", { min: 0 }), by);
    return Number(r.id);
  });
  return getAsset(id);
}

export async function updateAsset(id: number, b: Record<string, unknown>): Promise<Asset> {
  const f = assetFields(b, true);
  if ("tag" in b) f.tag = need(b.tag, "an asset tag", 40);
  await tx(async (tq) => {
    if ("parent_id" in f) await checkParent(tq, id, f.parent_id);
    const cols = Object.keys(f);
    if (!cols.length) return;
    const rows = await tq(`UPDATE assets SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...Object.values(f)]);
    if (!rows.length) throw new UserError("Asset not found", 404);
  });
  return getAsset(id);
}

async function readMeter(tq: Tq, assetId: number, value: number, by: string) {
  const [a] = await tq<{ meter_value: string | null; meter_unit: string }>("SELECT meter_value, meter_unit FROM assets WHERE id = $1 FOR UPDATE", [assetId]);
  if (!a) throw new UserError("Asset not found", 404);
  if (!a.meter_unit) throw new UserError("Give this asset a meter unit (hours, miles, cycles) first");
  if (a.meter_value !== null && value < num(a.meter_value)) throw new UserError(`The meter can't go backwards: it last read ${num(a.meter_value)}`);
  await tq("INSERT INTO meter_readings (asset_id, value, by_email) VALUES ($1, $2, $3)", [assetId, value, by]);
  await tq("UPDATE assets SET meter_value = $2, updated_at = now() WHERE id = $1", [assetId, value]);
}

/** Records a meter reading, then opens any maintenance the new reading made due. */
export async function addReading(assetId: number, b: Record<string, unknown>, by: string): Promise<Asset> {
  await tx((tq) => readMeter(tq, assetId, number(b.value, "a meter reading", { min: 0 }), by));
  await scheduleDue({ assetId });
  return getAsset(assetId);
}

export async function listReadings(assetId: number): Promise<{ value: number; by: string; at: string }[]> {
  const rows = await q("SELECT value, by_email, read_at FROM meter_readings WHERE asset_id = $1 ORDER BY read_at DESC LIMIT 50", [assetId]);
  return rows.map((r) => ({ value: num(r.value), by: String(r.by_email), at: new Date(r.read_at as string).toISOString() }));
}

export function depreciation(a: Asset) {
  const v = bookValue(a.purchaseCost, a.salvageValue, a.usefulLifeMonths, a.purchaseDate, today());
  return v ? { monthly: round(v.monthly, 2), accumulated: round(v.accumulated, 2), value: round(v.value, 2) } : null;
}

// ---------------------------------------------------------------- preventive maintenance plans

export type MaintPlan = {
  id: number; assetId: number; assetTag: string; assetName: string; title: string; instructions: string;
  intervalDays: number | null; intervalMeter: number | null; nextDue: string | null; nextMeter: number | null;
  assignee: string; estimatedMinutes: number; active: boolean; lastDone: string | null; due: string | null;
};

function toPlan(r: Record<string, unknown>): MaintPlan {
  const p = {
    id: Number(r.id), assetId: Number(r.asset_id), assetTag: String(r.tag), assetName: String(r.asset_name), title: String(r.title), instructions: String(r.instructions),
    intervalDays: r.interval_days === null ? null : Number(r.interval_days), intervalMeter: numOrNull(r.interval_meter),
    nextDue: (r.next_due as string | null) ?? null, nextMeter: numOrNull(r.next_meter), assignee: String(r.assignee),
    estimatedMinutes: Number(r.estimated_minutes), active: Boolean(r.active), lastDone: (r.last_done as string | null) ?? null, due: null as string | null,
  };
  p.due = p.active ? dueReason(p, today(), numOrNull(r.meter_value)) : null;
  return p;
}

const PLAN_SELECT = "SELECT p.*, a.tag, a.name AS asset_name, a.meter_value FROM maint_plans p JOIN assets a ON a.id = p.asset_id";

export async function listPlans(opts: { assetId?: number } = {}): Promise<MaintPlan[]> {
  const rows = opts.assetId
    ? await q(`${PLAN_SELECT} WHERE p.asset_id = $1 ORDER BY p.next_due NULLS LAST, p.id`, [opts.assetId])
    : await q(`${PLAN_SELECT} ORDER BY p.active DESC, p.next_due NULLS LAST, p.id LIMIT 1000`);
  return rows.map(toPlan);
}

export async function savePlan(id: number | null, b: Record<string, unknown>, by: string): Promise<MaintPlan> {
  const days = optNumber(b.intervalDays, "the interval in days", { above: 0, max: 3650 });
  const meter = optNumber(b.intervalMeter, "the meter interval", { above: 0 });
  if (days === null && meter === null) throw new UserError("Say how often: every so many days, or every so much on the meter, or both");
  const f = {
    title: need(b.title, "a title"),
    instructions: text(b.instructions, 8000),
    interval_days: days === null ? null : Math.round(days),
    interval_meter: meter,
    assignee: optEmail(b.assignee, "the assignee's email"),
    estimated_minutes: Math.round(number(b.estimatedMinutes, "estimated minutes", { min: 0, fallback: 0 })),
    active: b.active === undefined ? true : Boolean(b.active),
  };
  const planId = await tx(async (tq) => {
    if (id) {
      const rows = await tq(
        `UPDATE maint_plans SET title = $2, instructions = $3, interval_days = $4, interval_meter = $5, assignee = $6, estimated_minutes = $7, active = $8,
           next_due = CASE WHEN $4::int IS NULL THEN NULL WHEN interval_days IS DISTINCT FROM $4::int THEN COALESCE(last_done, CURRENT_DATE) + $4::int ELSE next_due END,
           next_meter = CASE WHEN $5::numeric IS NULL THEN NULL WHEN interval_meter IS DISTINCT FROM $5::numeric THEN COALESCE((SELECT meter_value FROM assets WHERE id = asset_id), 0) + $5::numeric ELSE next_meter END
         WHERE id = $1 RETURNING id`,
        [id, f.title, f.instructions, f.interval_days, f.interval_meter, f.assignee, f.estimated_minutes, f.active],
      );
      if (!rows.length) throw new UserError("Plan not found", 404);
      return id;
    }
    const assetId = Math.round(number(b.assetId, "the asset", { above: 0 }));
    const [a] = await tq<{ meter_value: string | null; meter_unit: string }>("SELECT meter_value, meter_unit FROM assets WHERE id = $1", [assetId]);
    if (!a) throw new UserError("Asset not found", 404);
    if (meter !== null && !a.meter_unit) throw new UserError("Give this asset a meter unit before planning work by meter");
    // A new plan is first due one interval from today, unless a first date is given.
    const first = optDate(b.nextDue, "first due date");
    const nextDue = f.interval_days ? first ?? advance({ intervalDays: f.interval_days, intervalMeter: null }, today(), null).nextDue : null;
    const nextMeter = meter !== null ? num(a.meter_value) + meter : null;
    const [r] = await tq<{ id: string }>(
      `INSERT INTO maint_plans (asset_id, title, instructions, interval_days, interval_meter, next_due, next_meter, assignee, estimated_minutes, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [assetId, f.title, f.instructions, f.interval_days, f.interval_meter, nextDue, nextMeter, f.assignee, f.estimated_minutes, f.active, by],
    );
    return Number(r.id);
  });
  const [r] = await q(`${PLAN_SELECT} WHERE p.id = $1`, [planId]);
  return toPlan(r);
}

export async function deletePlan(id: number): Promise<void> {
  await q("DELETE FROM maint_plans WHERE id = $1", [id]);
}

/**
 * Opens a preventive maintenance order for every active plan that is due, by date or by meter,
 * unless that plan already has one open. Safe to run as often as you like.
 */
export async function scheduleDue(opts: { assetId?: number } = {}): Promise<{ created: string[] }> {
  const t = today();
  const plans = await q<Record<string, unknown>>(
    `${PLAN_SELECT} WHERE p.active AND a.status IN ('active','in_repair') ${opts.assetId ? "AND p.asset_id = $1" : ""}
       AND NOT EXISTS (SELECT 1 FROM maint_orders o WHERE o.plan_id = p.id AND o.status IN ('open','in_progress','on_hold'))`,
    opts.assetId ? [opts.assetId] : [],
  );
  const created: string[] = [];
  for (const r of plans) {
    const p = toPlan(r);
    if (!p.due) continue;
    try {
      const number_ = await tx(async (tq) => {
        const n = await nextNumber(tq, "mo", "MO");
        await tq(
          `INSERT INTO maint_orders (number, asset_id, plan_id, kind, title, description, assignee, due_date, requested_by)
           VALUES ($1, $2, $3, 'preventive', $4, $5, $6, $7, 'scheduler')`,
          [n, p.assetId, p.id, p.title, p.instructions, p.assignee, p.nextDue && p.nextDue > t ? p.nextDue : t],
        );
        return n;
      });
      created.push(number_);
    } catch (e) {
      // Another run opened it first (one open order per plan).
      if ((e as { code?: string }).code !== "23505") throw e;
    }
  }
  return { created };
}

// ---------------------------------------------------------------- maintenance orders

export const MO_STATUSES = ["open", "in_progress", "on_hold", "done", "cancelled"] as const;
export const MO_KINDS = ["preventive", "corrective", "inspection"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type MaintOrder = {
  id: number; number: string; assetId: number; assetTag: string; assetName: string; location: string; planId: number | null;
  kind: (typeof MO_KINDS)[number]; title: string; description: string; priority: (typeof PRIORITIES)[number];
  status: (typeof MO_STATUSES)[number]; requestedBy: string; assignee: string; dueDate: string | null;
  laborMinutes: number; laborRate: number; downtimeMinutes: number; resolution: string; partsCost: number;
  createdAt: string; updatedAt: string; completedAt: string | null; late: boolean;
};
export type MaintPart = { id: number; itemId: number; sku: string; name: string; uom: string; qty: number; unitCost: number; by: string; at: string };

const MO_SELECT = `SELECT o.*, a.tag, a.name AS asset_name, a.location,
  COALESCE((SELECT sum(p.qty * p.unit_cost) FROM maint_parts p WHERE p.order_id = o.id), 0) AS parts_cost
  FROM maint_orders o JOIN assets a ON a.id = o.asset_id`;

function toOrder(r: Record<string, unknown>): MaintOrder {
  const due = (r.due_date as string | null) ?? null;
  const status = r.status as MaintOrder["status"];
  return {
    id: Number(r.id), number: String(r.number), assetId: Number(r.asset_id), assetTag: String(r.tag), assetName: String(r.asset_name), location: String(r.location),
    planId: r.plan_id === null ? null : Number(r.plan_id), kind: r.kind as MaintOrder["kind"], title: String(r.title), description: String(r.description),
    priority: r.priority as MaintOrder["priority"], status, requestedBy: String(r.requested_by), assignee: String(r.assignee), dueDate: due,
    laborMinutes: Number(r.labor_minutes), laborRate: num(r.labor_rate), downtimeMinutes: Number(r.downtime_minutes), resolution: String(r.resolution),
    partsCost: round(num(r.parts_cost), 2), createdAt: new Date(r.created_at as string).toISOString(), updatedAt: new Date(r.updated_at as string).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    late: !!due && due < today() && (status === "open" || status === "in_progress" || status === "on_hold"),
  };
}

export async function listOrders(opts: { status?: string; q?: string; mine?: string; assetId?: number } = {}): Promise<MaintOrder[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.status === "active") where.push("o.status IN ('open','in_progress','on_hold')");
  else if (opts.status && (MO_STATUSES as readonly string[]).includes(opts.status)) {
    params.push(opts.status);
    where.push(`o.status = $${params.length}`);
  }
  if (opts.mine) {
    params.push(opts.mine.toLowerCase());
    where.push(`lower(o.assignee) = $${params.length}`);
  }
  if (opts.assetId) {
    params.push(opts.assetId);
    where.push(`o.asset_id = $${params.length}`);
  }
  if (opts.q) {
    params.push(like(opts.q));
    const p = `$${params.length}`;
    where.push(`(o.number ILIKE ${p} OR o.title ILIKE ${p} OR o.description ILIKE ${p} OR a.tag ILIKE ${p} OR a.name ILIKE ${p})`);
  }
  const rows = await q(
    `${MO_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE o.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, o.due_date NULLS LAST, o.id DESC LIMIT 500`,
    params,
  );
  return rows.map(toOrder);
}

export async function getOrder(id: number): Promise<MaintOrder & { parts: MaintPart[] }> {
  const [r] = await q(`${MO_SELECT} WHERE o.id = $1`, [id]);
  if (!r) throw new UserError("Maintenance order not found", 404);
  const parts = await q("SELECT p.*, i.sku, i.name, i.uom FROM maint_parts p JOIN items i ON i.id = p.item_id WHERE p.order_id = $1 ORDER BY p.id", [id]);
  return {
    ...toOrder(r),
    parts: parts.map((p) => ({
      id: Number(p.id), itemId: Number(p.item_id), sku: String(p.sku), name: String(p.name), uom: String(p.uom), qty: num(p.qty), unitCost: num(p.unit_cost),
      by: String(p.by_email), at: new Date(p.added_at as string).toISOString(),
    })),
  };
}

/** A request for work on an asset: anyone signed in can report a fault. */
export async function createOrder(b: Record<string, unknown>, by: string): Promise<number> {
  const assetId = Math.round(number(b.assetId, "the asset", { above: 0 }));
  return tx(async (tq) => {
    const [a] = await tq<{ id: string }>("SELECT id FROM assets WHERE id = $1", [assetId]);
    if (!a) throw new UserError("Asset not found", 404);
    const n = await nextNumber(tq, "mo", "MO");
    const [r] = await tq<{ id: string }>(
      `INSERT INTO maint_orders (number, asset_id, kind, title, description, priority, assignee, due_date, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        n, assetId, oneOf(b.kind, MO_KINDS, "kind of work", "corrective"), need(b.title, "what needs doing"), text(b.description, 8000),
        oneOf(b.priority, PRIORITIES, "priority", "normal"), optEmail(b.assignee, "the assignee's email"), optDate(b.dueDate, "due date"), by,
      ],
    );
    return Number(r.id);
  });
}

/**
 * Edits a maintenance order or moves it along. Starting work puts the asset in repair; finishing
 * puts it back in service and, for planned work, sets when the plan is next due.
 */
export async function updateOrder(id: number, b: Record<string, unknown>, by: string): Promise<void> {
  await tx(async (tq) => {
    const [o] = await tq<{ status: string; asset_id: string; plan_id: string | null; kind: string }>(
      "SELECT status, asset_id, plan_id, kind FROM maint_orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!o) throw new UserError("Maintenance order not found", 404);
    const closed = o.status === "done" || o.status === "cancelled";
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (closed && Object.keys(b).some((k) => k !== "resolution")) throw new UserError("This maintenance order is closed");
    if ("title" in b) set("title", need(b.title, "a title"));
    if ("description" in b) set("description", text(b.description, 8000));
    if ("priority" in b) set("priority", oneOf(b.priority, PRIORITIES, "priority"));
    if ("kind" in b) set("kind", oneOf(b.kind, MO_KINDS, "kind of work"));
    if ("assignee" in b) set("assignee", optEmail(b.assignee, "the assignee's email"));
    if ("dueDate" in b) set("due_date", optDate(b.dueDate, "due date"));
    if ("laborMinutes" in b) set("labor_minutes", Math.round(number(b.laborMinutes, "labor minutes", { min: 0 })));
    if ("laborRate" in b) set("labor_rate", number(b.laborRate, "labor rate", { min: 0 }));
    if ("downtimeMinutes" in b) set("downtime_minutes", Math.round(number(b.downtimeMinutes, "downtime minutes", { min: 0 })));
    if ("resolution" in b) set("resolution", text(b.resolution, 8000));
    if ("status" in b && b.status !== o.status) {
      const s = oneOf(b.status, MO_STATUSES, "status");
      if (closed) throw new UserError("This maintenance order is closed");
      set("status", s);
      if (s === "in_progress") {
        sets.push("started_at = COALESCE(started_at, now())");
        if (o.kind !== "inspection") await tq("UPDATE assets SET status = 'in_repair', updated_at = now() WHERE id = $1 AND status = 'active'", [o.asset_id]);
      }
      if (s === "done" || s === "cancelled") {
        if (s === "done") sets.push("completed_at = now()");
        // Back in service once nothing else open has it in repair.
        await tq(
          `UPDATE assets SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'in_repair'
             AND NOT EXISTS (SELECT 1 FROM maint_orders WHERE asset_id = $1 AND id <> $2 AND status = 'in_progress')`,
          [o.asset_id, id],
        );
        if (s === "done" && o.plan_id) {
          const [p] = await tq<{ interval_days: number | null; interval_meter: string | null; meter_value: string | null }>(
            "SELECT p.interval_days, p.interval_meter, a.meter_value FROM maint_plans p JOIN assets a ON a.id = p.asset_id WHERE p.id = $1",
            [o.plan_id],
          );
          if (p) {
            const next = advance({ intervalDays: p.interval_days, intervalMeter: numOrNull(p.interval_meter) }, today(), numOrNull(p.meter_value));
            await tq("UPDATE maint_plans SET last_done = CURRENT_DATE, next_due = $2, next_meter = $3 WHERE id = $1", [o.plan_id, next.nextDue, next.nextMeter]);
          }
        }
      }
    }
    if (sets.length) await tq(`UPDATE maint_orders SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    void by;
  });
}

/** Takes spare parts from stock for the job, at their current cost. */
export async function addPart(orderId: number, b: Record<string, unknown>, by: string): Promise<void> {
  const itemId = Math.round(number(b.itemId, "the part", { above: 0 }));
  const qty = number(b.qty, "a quantity", { above: 0 });
  await tx(async (tq) => {
    const [o] = await tq<{ status: string; number: string }>("SELECT status, number FROM maint_orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!o) throw new UserError("Maintenance order not found", 404);
    if (o.status === "done" || o.status === "cancelled") throw new UserError("This maintenance order is closed");
    const { unitCost } = await moveStock(tq, { itemId, qty: -qty, kind: "maintenance", ref: o.number, note: "Used on maintenance", by });
    await tq("INSERT INTO maint_parts (order_id, item_id, qty, unit_cost, by_email) VALUES ($1, $2, $3, $4, $5)", [orderId, itemId, qty, unitCost, by]);
  });
}

/** Counts for the side navigation. */
export async function assetCounts(me: string) {
  const [r] = await q<Record<string, number>>(
    `SELECT
       (SELECT count(*)::int FROM assets WHERE status IN ('active','in_repair')) AS assets,
       (SELECT count(*)::int FROM maint_orders WHERE status IN ('open','in_progress','on_hold')) AS orders,
       (SELECT count(*)::int FROM maint_orders WHERE status IN ('open','in_progress','on_hold') AND lower(assignee) = $1) AS mine,
       (SELECT count(*)::int FROM maint_orders WHERE status IN ('open','in_progress','on_hold') AND due_date < CURRENT_DATE) AS late`,
    [me.toLowerCase()],
  );
  return { ...r, booksLinked: booksLinked() };
}
