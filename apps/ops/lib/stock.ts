import { SYNCED_KINDS, assertLocalStock, commerceLinked } from "./commerce";
import { type Tq, num, q, tx } from "./db";
import { UserError, need, number, oneOf, round, text } from "./util";

export type Item = {
  id: number;
  sku: string;
  name: string;
  description: string;
  uom: string;
  source: "make" | "buy";
  unitCost: number;
  onHand: number;
  safetyStock: number;
  reorderPoint: number;
  lotSize: number;
  leadDays: number;
  active: boolean;
  commerceId: string | null;
  hasBom: boolean;
  updatedAt: string;
};

export type Move = {
  id: number;
  itemId: number;
  sku: string;
  qty: number;
  unitCost: number;
  kind: MoveKind;
  ref: string;
  note: string;
  by: string;
  syncStatus: string;
  syncError: string;
  createdAt: string;
};

export const MOVE_KINDS = ["receipt", "adjust", "issue", "produce", "maintenance"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

const ITEM_SELECT = `SELECT i.*, EXISTS (SELECT 1 FROM boms b WHERE b.item_id = i.id AND b.status = 'active') AS has_bom FROM items i`;

type ItemRow = Record<string, unknown>;

export function toItem(r: ItemRow): Item {
  return {
    id: Number(r.id),
    sku: String(r.sku),
    name: String(r.name),
    description: String(r.description ?? ""),
    uom: String(r.uom ?? "ea"),
    source: r.source as Item["source"],
    unitCost: num(r.unit_cost),
    onHand: num(r.on_hand),
    safetyStock: num(r.safety_stock),
    reorderPoint: num(r.reorder_point),
    lotSize: num(r.lot_size),
    leadDays: Number(r.lead_days ?? 0),
    active: Boolean(r.active),
    commerceId: (r.commerce_id as string | null) ?? null,
    hasBom: Boolean(r.has_bom),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

function toMove(r: ItemRow): Move {
  return {
    id: Number(r.id),
    itemId: Number(r.item_id),
    sku: String(r.sku ?? ""),
    qty: num(r.qty),
    unitCost: num(r.unit_cost),
    kind: r.kind as MoveKind,
    ref: String(r.ref ?? ""),
    note: String(r.note ?? ""),
    by: String(r.by_email ?? ""),
    syncStatus: String(r.sync_status),
    syncError: String(r.sync_error ?? ""),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function listItems(opts: { q?: string; source?: string; low?: boolean; all?: boolean } = {}): Promise<Item[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.all) where.push("i.active");
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(i.sku ILIKE $${params.length} OR i.name ILIKE $${params.length})`);
  }
  if (opts.source === "make" || opts.source === "buy") {
    params.push(opts.source);
    where.push(`i.source = $${params.length}`);
  }
  if (opts.low) where.push("i.reorder_point > 0 AND i.on_hand < i.reorder_point");
  const rows = await q(`${ITEM_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY lower(i.sku) LIMIT 1000`, params);
  return rows.map(toItem);
}

export async function getItem(id: number): Promise<Item> {
  const [r] = await q(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
  if (!r) throw new UserError("Item not found", 404);
  return toItem(r);
}

export async function itemBySku(sku: string): Promise<Item | null> {
  const [r] = await q(`${ITEM_SELECT} WHERE lower(i.sku) = lower($1)`, [sku]);
  return r ? toItem(r) : null;
}

function itemFields(b: Record<string, unknown>, partial: boolean) {
  const has = (k: string) => !partial || k in b;
  const out: Record<string, unknown> = {};
  if (has("sku")) {
    const sku = need(b.sku, "a SKU", 64);
    if (/\s/.test(sku)) throw new UserError("A SKU can't contain spaces");
    out.sku = sku;
  }
  if (has("name")) out.name = need(b.name, "a name");
  if (has("description")) out.description = text(b.description, 2000);
  if (has("uom")) out.uom = text(b.uom, 16) || "ea";
  if (has("source")) out.source = oneOf(b.source, ["make", "buy"] as const, "make or buy", "buy");
  if (has("unitCost")) out.unit_cost = number(b.unitCost, "unit cost", { min: 0, fallback: 0 });
  if (has("safetyStock")) out.safety_stock = number(b.safetyStock, "safety stock", { min: 0, fallback: 0 });
  if (has("reorderPoint")) out.reorder_point = number(b.reorderPoint, "reorder point", { min: 0, fallback: 0 });
  if (has("lotSize")) out.lot_size = number(b.lotSize, "lot size", { min: 0, fallback: 0 });
  if (has("leadDays")) out.lead_days = Math.round(number(b.leadDays, "lead time", { min: 0, max: 3650, fallback: 0 }));
  if (partial && "active" in b) out.active = Boolean(b.active);
  return out;
}

export async function createItem(b: Record<string, unknown>, by = ""): Promise<Item> {
  const f = itemFields(b, false);
  const onHand = number(b.onHand, "quantity on hand", { min: 0, fallback: 0 });
  if (onHand > 0) assertLocalStock();
  const id = await tx(async (tq) => {
    const cols = Object.keys(f);
    const [r] = await tq<{ id: string }>(
      `INSERT INTO items (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      Object.values(f),
    );
    if (onHand > 0) await moveStock(tq, { itemId: Number(r.id), qty: onHand, unitCost: f.unit_cost as number, kind: "adjust", note: "Opening stock", by });
    return Number(r.id);
  });
  return getItem(id);
}

export async function updateItem(id: number, b: Record<string, unknown>): Promise<Item> {
  const f = itemFields(b, true);
  const cols = Object.keys(f);
  if (cols.length) {
    const rows = await q(
      `UPDATE items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, ...Object.values(f)],
    );
    if (!rows.length) throw new UserError("Item not found", 404);
  }
  return getItem(id);
}

/** Items used anywhere are made inactive instead, so history keeps its names. */
export async function deleteItem(id: number): Promise<{ deleted: boolean }> {
  const [used] = await q<{ used: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM stock_moves WHERE item_id = $1) OR EXISTS (SELECT 1 FROM bom_lines WHERE component_id = $1)
       OR EXISTS (SELECT 1 FROM boms WHERE item_id = $1) OR EXISTS (SELECT 1 FROM work_orders WHERE item_id = $1)
       OR EXISTS (SELECT 1 FROM maint_parts WHERE item_id = $1) OR EXISTS (SELECT 1 FROM purchase_requests WHERE item_id = $1) AS used`,
    [id],
  );
  if (used?.used) {
    await q("UPDATE items SET active = false, updated_at = now() WHERE id = $1", [id]);
    return { deleted: false };
  }
  await q("DELETE FROM items WHERE id = $1", [id]);
  return { deleted: true };
}

export type MoveInput = {
  itemId: number;
  /** Signed: positive adds stock, negative takes it. */
  qty: number;
  /** Cost of what arrives; issues always go out at the item's current cost. */
  unitCost?: number;
  kind: MoveKind;
  ref?: string;
  note?: string;
  by?: string;
};

/**
 * Changes stock on hand inside a transaction and records why. Stock can't go below zero.
 * Receipts with a cost move the item's cost to the weighted average of old and new stock.
 * When Commerce is linked, issues, finished goods and parts used are queued for it (see commerce.ts).
 */
export async function moveStock(tq: Tq, m: MoveInput): Promise<{ moveId: number; unitCost: number }> {
  if (!Number.isFinite(m.qty) || Math.abs(m.qty) < 1e-9) throw new UserError("Enter a quantity");
  const [it] = await tq<{ sku: string; name: string; on_hand: string; unit_cost: string }>(
    "SELECT sku, name, on_hand, unit_cost FROM items WHERE id = $1 FOR UPDATE",
    [m.itemId],
  );
  if (!it) throw new UserError("Item not found", 404);
  const have = num(it.on_hand);
  const cost = num(it.unit_cost);
  const after = round(have + m.qty);
  if (after < 0) throw new UserError(`Not enough ${it.sku} on hand: ${round(have)} there, ${round(-m.qty)} needed`);
  let unitCost = cost;
  let newCost = cost;
  if (m.qty > 0 && m.unitCost !== undefined && m.unitCost >= 0) {
    unitCost = m.unitCost;
    newCost = after > 0 ? round((Math.max(have, 0) * cost + m.qty * m.unitCost) / (Math.max(have, 0) + m.qty)) : m.unitCost;
  }
  await tq("UPDATE items SET on_hand = $2, unit_cost = $3, updated_at = now() WHERE id = $1", [m.itemId, after, newCost]);
  const [r] = await tq<{ id: string }>(
    `INSERT INTO stock_moves (item_id, qty, unit_cost, kind, ref, note, by_email, sync_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [m.itemId, m.qty, unitCost, m.kind, text(m.ref, 120), text(m.note, 500), m.by ?? "", commerceLinked() && SYNCED_KINDS.includes(m.kind) ? "pending" : "off"],
  );
  return { moveId: Number(r.id), unitCost };
}

/** A receipt or count correction typed in by someone. */
export async function adjust(itemId: number, b: Record<string, unknown>, by: string): Promise<Item> {
  assertLocalStock();
  const kind = oneOf(b.kind, ["receipt", "adjust"] as const, "kind of change", "adjust");
  const qty = number(b.qty, "quantity");
  const unitCost = b.unitCost === undefined || b.unitCost === "" ? undefined : number(b.unitCost, "unit cost", { min: 0 });
  if (kind === "receipt" && qty <= 0) throw new UserError("A receipt adds stock; use an adjustment to take it away");
  await tx((tq) => moveStock(tq, { itemId, qty, unitCost, kind, ref: text(b.ref, 120), note: text(b.note, 500), by }));
  return getItem(itemId);
}

export async function listMoves(opts: { itemId?: number; limit?: number } = {}): Promise<Move[]> {
  const params: unknown[] = [Math.min(opts.limit ?? 100, 500)];
  let where = "";
  if (opts.itemId) {
    params.push(opts.itemId);
    where = "WHERE m.item_id = $2";
  }
  const rows = await q(
    `SELECT m.*, i.sku FROM stock_moves m JOIN items i ON i.id = m.item_id ${where} ORDER BY m.id DESC LIMIT $1`,
    params,
  );
  return rows.map(toMove);
}
