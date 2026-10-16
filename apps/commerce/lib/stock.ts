/**
 * The stock ledger. `move` is the only thing that changes how many of something are on a shelf:
 * it writes the movement and the running count together, and on a receipt it moves the product's
 * average cost. Everything else (sales, deliveries, counts) goes through it.
 */
import { q, tx, type Tq } from "./db";
import { adjustmentLines, enqueue } from "./books";
import { assertLocation } from "./catalog";
import { assertManager } from "./members";
import { fromCents, movingAverage, qty as roundQty } from "./money";
import { getSettings } from "./settings";
import type { Ctx, Movement, MovementKind } from "./types";
import { UserError, isUuid, quantity, text } from "./util";

export type Move = {
  productId: string;
  locationId: string;
  /** Signed: positive puts stock on the shelf, negative takes it off. */
  qty: number;
  kind: MovementKind;
  /** Per unit, for a receipt. Other moves use the product's current average cost. */
  unitCost?: number;
  refType?: string;
  refId?: string;
  note?: string;
  by: string;
};

/** Applies one movement inside the caller's transaction; returns the unit cost it was valued at. */
export async function move(tq: Tq, m: Move): Promise<number> {
  const [p] = await tq<{ cost: string; track_stock: boolean; total: string }>(
    `SELECT cost, track_stock, COALESCE((SELECT sum(on_hand) FROM stock WHERE product_id = $1), 0) AS total
     FROM products WHERE id = $1 FOR UPDATE`,
    [m.productId],
  );
  if (!p) throw new UserError("Product not found", 404);
  let unitCost = Number(p.cost);
  if (m.kind === "receive" && m.unitCost !== undefined) {
    const next = movingAverage(Number(p.total), unitCost, m.qty, m.unitCost);
    await tq("UPDATE products SET cost = $2, modified_at = now() WHERE id = $1", [m.productId, next]);
    unitCost = m.unitCost;
  }
  // Products that aren't tracked (services, gift wrap) are sold without touching the shelves.
  if (!p.track_stock) return unitCost;
  await tq(
    `INSERT INTO stock (product_id, location_id, on_hand) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, location_id) DO UPDATE SET on_hand = stock.on_hand + EXCLUDED.on_hand`,
    [m.productId, m.locationId, roundQty(m.qty)],
  );
  await tq(
    `INSERT INTO movements (product_id, location_id, qty, unit_cost, kind, ref_type, ref_id, note, by_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [m.productId, m.locationId, roundQty(m.qty), unitCost, m.kind, m.refType ?? null, m.refId ?? null, m.note ?? "", m.by],
  );
  return unitCost;
}

async function onHand(tq: Tq, productId: string, locationId: string): Promise<number> {
  const [r] = await tq<{ on_hand: string }>("SELECT on_hand FROM stock WHERE product_id = $1 AND location_id = $2", [productId, locationId]);
  return Number(r?.on_hand ?? 0);
}

async function trackedProduct(tq: Tq, id: unknown): Promise<{ id: string; sku: string }> {
  if (!isUuid(id)) throw new UserError("Pick a product");
  const [p] = await tq<{ id: string; sku: string; track_stock: boolean }>("SELECT id, sku, track_stock FROM products WHERE id = $1", [id]);
  if (!p) throw new UserError("Product not found", 404);
  if (!p.track_stock) throw new UserError(`${p.sku} isn't stock-tracked`);
  return p;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Corrects stock by a number (damaged, found, used in-house) or to a counted number. Either way the
 * difference is valued at average cost and posted to Books as a stock gain or loss.
 */
export async function adjust(
  ctx: Ctx,
  input: { productId: unknown; locationId: unknown; mode?: unknown; qty: unknown; note?: unknown },
): Promise<{ onHand: number; change: number }> {
  assertManager(ctx);
  const locationId = await assertLocation(input.locationId);
  const counted = input.mode === "count";
  const note = text(input.note, 300);
  const settings = await getSettings();
  return tx(async (tq) => {
    const p = await trackedProduct(tq, input.productId);
    const before = await onHand(tq, p.id, locationId);
    const target = counted ? quantity(input.qty, "Counted quantity", false) : null;
    if (target !== null && target < 0) throw new UserError("A count can't be negative");
    const change = target !== null ? roundQty(target - before) : quantity(input.qty, "Change", false);
    if (change === 0) return { onHand: before, change: 0 };
    const [{ id: ref }] = await tq<{ id: string }>("SELECT gen_random_uuid()::text AS id");
    const cost = await move(tq, {
      productId: p.id, locationId, qty: change, kind: counted ? "count" : "adjust", refType: "adjustment", refId: ref, note, by: ctx.email,
    });
    const value = Math.round(change * cost * 100);
    await enqueue(tq, {
      reference: `commerce:adjust:${ref}`,
      kind: "adjustment",
      date: today(),
      description: `${counted ? "Stock count" : "Stock adjustment"}: ${p.sku} ${change > 0 ? "+" : ""}${change}`,
      lines: adjustmentLines(settings, p.sku, value, note || (counted ? "Stock count" : "Stock adjustment")),
    });
    return { onHand: roundQty(before + change), change };
  });
}

/** Moves stock between two locations. Cost doesn't change, so nothing goes to Books. */
export async function transfer(
  ctx: Ctx,
  input: { productId: unknown; from: unknown; to: unknown; qty: unknown; note?: unknown },
): Promise<{ from: number; to: number }> {
  assertManager(ctx);
  const from = await assertLocation(input.from);
  const to = await assertLocation(input.to);
  if (from === to) throw new UserError("Pick two different locations");
  const n = quantity(input.qty);
  const note = text(input.note, 300);
  return tx(async (tq) => {
    const p = await trackedProduct(tq, input.productId);
    const [{ id: ref }] = await tq<{ id: string }>("SELECT gen_random_uuid()::text AS id");
    await move(tq, { productId: p.id, locationId: from, qty: -n, kind: "transfer_out", refType: "transfer", refId: ref, note, by: ctx.email });
    await move(tq, { productId: p.id, locationId: to, qty: n, kind: "transfer_in", refType: "transfer", refId: ref, note, by: ctx.email });
    return { from: await onHand(tq, p.id, from), to: await onHand(tq, p.id, to) };
  });
}

type MoveRow = {
  id: string; product_id: string; sku: string; product_name: string; location_name: string; qty: string; unit_cost: string;
  kind: MovementKind; ref_type: string | null; ref_id: string | null; note: string; by_email: string; at: Date;
};

export async function movements(f: { productId?: string; locationId?: string; limit?: number } = {}): Promise<Movement[]> {
  const rows = await q<MoveRow>(
    `SELECT m.id, m.product_id, p.sku, p.name AS product_name, l.name AS location_name, m.qty, m.unit_cost, m.kind, m.ref_type, m.ref_id,
       m.note, m.by_email, m.at
     FROM movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
     WHERE ($1::uuid IS NULL OR m.product_id = $1) AND ($2::uuid IS NULL OR m.location_id = $2)
     ORDER BY m.at DESC, m.id DESC LIMIT $3`,
    [isUuid(f.productId) ? f.productId : null, isUuid(f.locationId) ? f.locationId : null, Math.min(f.limit ?? 200, 1000)],
  );
  return rows.map((r) => ({
    id: String(r.id), productId: r.product_id, sku: r.sku, productName: r.product_name, locationName: r.location_name, qty: Number(r.qty),
    unitCost: Number(r.unit_cost).toFixed(2), kind: r.kind, refType: r.ref_type, refId: r.ref_id, note: r.note, by: r.by_email,
    at: r.at.toISOString(),
  }));
}

export type StockRow = { productId: string; sku: string; name: string; category: string; cost: string; levels: Record<string, number>; total: number; value: string };

/** Every tracked product's count at every location, valued at average cost. */
export async function stockSheet(f: { q?: string; locationId?: string } = {}): Promise<{ rows: StockRow[]; totalValue: string }> {
  const rows = await q<{ id: string; sku: string; name: string; category: string; cost: string; levels: Record<string, string> | null }>(
    `SELECT p.id, p.sku, p.name, p.category, p.cost,
       (SELECT jsonb_object_agg(s.location_id, s.on_hand) FROM stock s WHERE s.product_id = p.id) AS levels
     FROM products p
     WHERE p.active AND p.track_stock AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%')
     ORDER BY lower(p.name), p.sku LIMIT 2000`,
    [text(f.q, 100).replace(/[\\%_]/g, (c) => `\\${c}`)],
  );
  let total = 0;
  const out = rows.map((r): StockRow => {
    const levels: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.levels ?? {})) levels[k] = Number(v);
    const count = isUuid(f.locationId) ? levels[f.locationId] ?? 0 : Object.values(levels).reduce((a, b) => a + b, 0);
    const value = Math.round(Math.max(0, count) * Number(r.cost) * 100);
    total += value;
    return { productId: r.id, sku: r.sku, name: r.name, category: r.category, cost: Number(r.cost).toFixed(2), levels, total: roundQty(count), value: fromCents(value) };
  });
  return { rows: out, totalValue: fromCents(total) };
}

export type Suggestion = {
  productId: string; sku: string; name: string; vendorId: string | null; vendorName: string | null; onHand: number; onOrder: number;
  reorderPoint: number; suggest: number; unitCost: string;
};

/**
 * What to buy: tracked products at or under their reorder point, counting what is already on open
 * purchase orders, topped up by the reorder quantity (or back to the reorder point when none is set).
 */
export async function reorderSuggestions(): Promise<Suggestion[]> {
  const rows = await q<{
    id: string; sku: string; name: string; vendor_id: string | null; vendor_name: string | null; on_hand: string; on_order: string;
    reorder_point: string; reorder_qty: string; cost: string;
  }>(
    `SELECT p.id, p.sku, p.name, p.vendor_id, v.name AS vendor_name, p.reorder_point, p.reorder_qty, p.cost,
       COALESCE((SELECT sum(on_hand) FROM stock WHERE product_id = p.id), 0) AS on_hand,
       COALESCE((SELECT sum(l.qty - l.received) FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id
                 WHERE l.product_id = p.id AND o.status IN ('draft', 'ordered', 'partial') AND l.qty > l.received), 0) AS on_order
     FROM products p LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.active AND p.track_stock AND p.reorder_point > 0
     ORDER BY v.name NULLS LAST, lower(p.name)`,
  );
  const out: Suggestion[] = [];
  for (const r of rows) {
    const have = Number(r.on_hand) + Number(r.on_order);
    const point = Number(r.reorder_point);
    if (have > point) continue;
    const suggest = roundQty(Math.max(Number(r.reorder_qty), point - have + 1));
    out.push({
      productId: r.id, sku: r.sku, name: r.name, vendorId: r.vendor_id, vendorName: r.vendor_name, onHand: Number(r.on_hand),
      onOrder: Number(r.on_order), reorderPoint: point, suggest, unitCost: Number(r.cost).toFixed(2),
    });
  }
  return out;
}

