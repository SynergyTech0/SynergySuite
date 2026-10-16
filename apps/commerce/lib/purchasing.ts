/**
 * Buying stock. A purchase order is drafted, sent to the vendor ("ordered"), then received in one
 * or more deliveries. Each delivery puts the goods on the shelf at the price paid, moves the
 * products' average cost, and becomes a bill from the vendor in Books.
 */
import { q, tx, type Tq } from "./db";
import { enqueue, receiptLines } from "./books";
import { assertLocation } from "./catalog";
import { assertManager } from "./members";
import { fromCents, qty as roundQty, toCents } from "./money";
import { getSettings } from "./settings";
import { move, reorderSuggestions } from "./stock";
import type { Ctx, PoStatus, PurchaseOrder } from "./types";
import { UserError, cents, isUuid, isoDate, quantity, text } from "./util";

type PoRow = {
  id: string; number: string; vendor_id: string; vendor_name: string; location_id: string; location_name: string; status: PoStatus;
  expected: string | null; notes: string; created_by: string; created_at: Date; ordered_at: Date | null;
};

const PO_SELECT = `SELECT o.id, o.number, o.vendor_id, v.name AS vendor_name, o.location_id, l.name AS location_name, o.status,
  to_char(o.expected, 'YYYY-MM-DD') AS expected, o.notes, o.created_by, o.created_at, o.ordered_at
  FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id JOIN locations l ON l.id = o.location_id`;

async function load(tq: Tq, id: string): Promise<PurchaseOrder> {
  if (!isUuid(id)) throw new UserError("Purchase order not found", 404);
  const [o] = await tq<PoRow>(`${PO_SELECT} WHERE o.id = $1`, [id]);
  if (!o) throw new UserError("Purchase order not found", 404);
  const lines = await tq<{ id: string; product_id: string; sku: string; name: string; qty: string; unit_cost: string; received: string }>(
    `SELECT pl.id, pl.product_id, p.sku, p.name, pl.qty, pl.unit_cost, pl.received
     FROM po_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.po_id = $1 ORDER BY pl.position, pl.id`,
    [id],
  );
  const receipts = await tq<{ seq: number; vendor_ref: string; received_by: string; received_at: Date; total: string }>(
    `SELECT r.seq, r.vendor_ref, r.received_by, r.received_at, COALESCE(sum(rl.qty * rl.unit_cost), 0) AS total
     FROM receipts r LEFT JOIN receipt_lines rl ON rl.receipt_id = r.id WHERE r.po_id = $1 GROUP BY r.id ORDER BY r.seq`,
    [id],
  );
  const total = lines.reduce((a, l) => a + Math.round(Number(l.qty) * Number(l.unit_cost) * 100), 0);
  return {
    id: o.id, number: o.number, vendorId: o.vendor_id, vendorName: o.vendor_name, locationId: o.location_id, locationName: o.location_name,
    status: o.status, expected: o.expected, notes: o.notes, createdBy: o.created_by, createdAt: o.created_at.toISOString(),
    orderedAt: o.ordered_at?.toISOString() ?? null, total: fromCents(total),
    lines: lines.map((l) => ({
      id: l.id, productId: l.product_id, sku: l.sku, name: l.name, qty: Number(l.qty), unitCost: Number(l.unit_cost).toFixed(2), received: Number(l.received),
    })),
    receipts: receipts.map((r) => ({
      seq: r.seq, vendorRef: r.vendor_ref, receivedBy: r.received_by, receivedAt: r.received_at.toISOString(), total: fromCents(Math.round(Number(r.total) * 100)),
    })),
  };
}

export async function purchaseOrder(id: string): Promise<PurchaseOrder> {
  return load(q, id);
}

export type PoSummary = Omit<PurchaseOrder, "lines" | "receipts"> & { lineCount: number };

export async function purchaseOrders(f: { status?: string; vendorId?: string; q?: string } = {}): Promise<PoSummary[]> {
  const term = text(f.q, 60);
  const rows = await q<PoRow & { total: string; line_count: number }>(
    `${PO_SELECT.replace("FROM purchase_orders", `, COALESCE((SELECT sum(qty * unit_cost) FROM po_lines WHERE po_id = o.id), 0) AS total,
       (SELECT count(*)::int FROM po_lines WHERE po_id = o.id) AS line_count FROM purchase_orders`)}
     WHERE ($1::text IS NULL OR o.status = $1 OR ($1 = 'open' AND o.status IN ('draft', 'ordered', 'partial')))
       AND ($2::uuid IS NULL OR o.vendor_id = $2)
       AND ($3 = '' OR o.number ILIKE '%' || $3 || '%' OR v.name ILIKE '%' || $3 || '%')
     ORDER BY o.created_at DESC LIMIT 500`,
    [f.status || null, isUuid(f.vendorId) ? f.vendorId : null, term.replace(/[\\%_]/g, (c) => `\\${c}`)],
  );
  return rows.map((o) => ({
    id: o.id, number: o.number, vendorId: o.vendor_id, vendorName: o.vendor_name, locationId: o.location_id, locationName: o.location_name,
    status: o.status, expected: o.expected, notes: o.notes, createdBy: o.created_by, createdAt: o.created_at.toISOString(),
    orderedAt: o.ordered_at?.toISOString() ?? null, total: fromCents(Math.round(Number(o.total) * 100)), lineCount: o.line_count,
  }));
}

type LineInput = { productId?: unknown; qty?: unknown; unitCost?: unknown };

async function writeLines(tq: Tq, poId: string, lines: unknown): Promise<void> {
  if (!Array.isArray(lines)) throw new UserError("Add at least one line");
  if (lines.length > 500) throw new UserError("A purchase order can have up to 500 lines");
  await tq("DELETE FROM po_lines WHERE po_id = $1", [poId]);
  for (const [i, raw] of (lines as LineInput[]).entries()) {
    if (!isUuid(raw.productId)) throw new UserError(`Line ${i + 1}: pick a product`);
    const [p] = await tq<{ track_stock: boolean; sku: string }>("SELECT track_stock, sku FROM products WHERE id = $1", [raw.productId]);
    if (!p) throw new UserError(`Line ${i + 1}: product not found`);
    if (!p.track_stock) throw new UserError(`${p.sku} isn't stock-tracked, so it can't be ordered`);
    await tq("INSERT INTO po_lines (po_id, product_id, qty, unit_cost, position) VALUES ($1, $2, $3, $4, $5)", [
      poId, raw.productId, quantity(raw.qty, `Line ${i + 1} quantity`), fromCents(cents(raw.unitCost, `Line ${i + 1} cost`)), i,
    ]);
  }
}

async function nextNumber(tq: Tq): Promise<string> {
  const [{ n }] = await tq<{ n: string }>("SELECT nextval('po_number_seq') AS n");
  return `PO-${String(n).padStart(5, "0")}`;
}

/** A new draft. Lines may be left out and added later. */
export async function createPo(ctx: Ctx, input: Record<string, unknown>): Promise<PurchaseOrder> {
  assertManager(ctx);
  if (!isUuid(input.vendorId)) throw new UserError("Pick a vendor");
  const locationId = await assertLocation(input.locationId);
  return tx(async (tq) => {
    const [v] = await tq("SELECT 1 FROM vendors WHERE id = $1", [input.vendorId]);
    if (!v) throw new UserError("Vendor not found");
    const [o] = await tq<{ id: string }>(
      `INSERT INTO purchase_orders (number, vendor_id, location_id, expected, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [await nextNumber(tq), input.vendorId, locationId, isoDate(input.expected, "expected date"), text(input.notes, 2000), ctx.email],
    );
    if (input.lines !== undefined) await writeLines(tq, o.id, input.lines);
    return load(tq, o.id);
  });
}

/** Changes a draft: vendor, delivery location, date, notes and lines. Sent orders only take notes and dates. */
export async function updatePo(ctx: Ctx, id: string, input: Record<string, unknown>): Promise<PurchaseOrder> {
  assertManager(ctx);
  return tx(async (tq) => {
    const cur = await load(tq, id);
    if (cur.status === "received" || cur.status === "cancelled") throw new UserError("This purchase order is closed");
    const expected = input.expected !== undefined ? isoDate(input.expected, "expected date") : cur.expected;
    const notes = input.notes !== undefined ? text(input.notes, 2000) : cur.notes;
    if (cur.status !== "draft") {
      if (input.lines !== undefined || input.vendorId !== undefined || input.locationId !== undefined) {
        throw new UserError("Only a draft's vendor, location and lines can change");
      }
    } else {
      const vendorId = input.vendorId !== undefined ? input.vendorId : cur.vendorId;
      if (!isUuid(vendorId)) throw new UserError("Pick a vendor");
      const locationId = input.locationId !== undefined ? await assertLocation(input.locationId) : cur.locationId;
      await tq("UPDATE purchase_orders SET vendor_id = $2, location_id = $3 WHERE id = $1", [id, vendorId, locationId]);
      if (input.lines !== undefined) await writeLines(tq, id, input.lines);
    }
    await tq("UPDATE purchase_orders SET expected = $2, notes = $3, modified_at = now() WHERE id = $1", [id, expected, notes]);
    return load(tq, id);
  });
}

/** Marks a draft as sent to the vendor. */
export async function placePo(ctx: Ctx, id: string): Promise<PurchaseOrder> {
  assertManager(ctx);
  return tx(async (tq) => {
    const cur = await load(tq, id);
    if (cur.status !== "draft") throw new UserError("Only a draft can be placed");
    if (!cur.lines.length) throw new UserError("Add at least one line first");
    await tq("UPDATE purchase_orders SET status = 'ordered', ordered_at = now(), modified_at = now() WHERE id = $1", [id]);
    return load(tq, id);
  });
}

/** Cancels what hasn't arrived. Anything already received stays received. */
export async function cancelPo(ctx: Ctx, id: string): Promise<PurchaseOrder> {
  assertManager(ctx);
  return tx(async (tq) => {
    const cur = await load(tq, id);
    if (cur.status === "received" || cur.status === "cancelled") throw new UserError("This purchase order is already closed");
    // A part-received order closes as received: what came is all that will come.
    const next = cur.status === "partial" ? "received" : "cancelled";
    await tq("UPDATE purchase_orders SET status = $2, modified_at = now() WHERE id = $1", [id, next]);
    return load(tq, id);
  });
}

/**
 * Books a delivery against an order: `lines` names how many of each order line arrived, and at
 * what cost when the invoice differs from the order. Staff can receive; it is what they do at the door.
 */
export async function receive(
  ctx: Ctx,
  id: string,
  input: { lines?: { lineId?: unknown; qty?: unknown; unitCost?: unknown }[]; vendorRef?: unknown; note?: unknown; all?: unknown },
): Promise<PurchaseOrder> {
  const settings = await getSettings();
  return tx(async (tq) => {
    await tq("SELECT 1 FROM purchase_orders WHERE id = $1 FOR UPDATE", [isUuid(id) ? id : null]);
    const po = await load(tq, id);
    if (po.status !== "ordered" && po.status !== "partial") {
      throw new UserError(po.status === "draft" ? "Place the order before receiving it" : "This purchase order is closed");
    }
    const wanted = input.all
      ? po.lines.filter((l) => l.qty > l.received).map((l) => ({ lineId: l.id, qty: roundQty(l.qty - l.received), unitCost: undefined as unknown }))
      : (input.lines ?? []).filter((l) => l.qty !== undefined && l.qty !== "" && Number(l.qty) !== 0);
    if (!wanted.length) throw new UserError("Enter how many of something arrived");
    const [{ seq }] = await tq<{ seq: number }>("SELECT COALESCE(max(seq), 0) + 1 AS seq FROM receipts WHERE po_id = $1", [id]);
    const [r] = await tq<{ id: string }>(
      "INSERT INTO receipts (po_id, seq, vendor_ref, note, received_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [id, seq, text(input.vendorRef, 80), text(input.note, 500), ctx.email],
    );
    let value = 0;
    for (const w of wanted) {
      const line = po.lines.find((l) => l.id === w.lineId);
      if (!line) throw new UserError("That line isn't on this purchase order");
      const n = quantity(w.qty, `${line.sku} quantity`);
      if (roundQty(line.received + n) > line.qty) throw new UserError(`More ${line.sku} than was ordered: ${line.qty - line.received} left to receive`);
      const unitCost = w.unitCost === undefined || w.unitCost === "" ? toCents(line.unitCost) : cents(w.unitCost, `${line.sku} cost`);
      await move(tq, {
        productId: line.productId, locationId: po.locationId, qty: n, kind: "receive", unitCost: unitCost / 100,
        refType: "purchase_order", refId: po.id, note: `${po.number} delivery ${seq}`, by: ctx.email,
      });
      await tq("INSERT INTO receipt_lines (receipt_id, po_line_id, qty, unit_cost) VALUES ($1, $2, $3, $4)", [r.id, line.id, n, fromCents(unitCost)]);
      await tq("UPDATE po_lines SET received = received + $2 WHERE id = $1", [line.id, n]);
      value += Math.round(n * unitCost);
    }
    const [left] = await tq("SELECT 1 FROM po_lines WHERE po_id = $1 AND received < qty", [id]);
    await tq("UPDATE purchase_orders SET status = $2, modified_at = now() WHERE id = $1", [id, left ? "partial" : "received"]);
    const [v] = await tq<{ name: string; email: string; lead_days: number }>("SELECT name, email, lead_days FROM vendors WHERE id = $1", [po.vendorId]);
    await enqueue(tq, {
      reference: `commerce:receipt:${po.number}-R${seq}`,
      kind: "receipt",
      date: new Date().toISOString().slice(0, 10),
      description: `${po.number} delivery ${seq} from ${v.name}`,
      lines: receiptLines(settings, `${po.number}-R${seq}`, value),
      bill: { vendor: { name: v.name, email: v.email }, number: `${po.number}-R${seq}`, vendorRef: text(input.vendorRef, 80), dueDays: 30 },
    });
    return load(tq, id);
  });
}

/** Drafts one purchase order per vendor from the reorder suggestions the manager ticked. */
export async function draftFromSuggestions(ctx: Ctx, input: { productIds?: unknown; locationId?: unknown }): Promise<PurchaseOrder[]> {
  assertManager(ctx);
  const locationId = await assertLocation(input.locationId);
  const pick = new Set(Array.isArray(input.productIds) ? input.productIds.map(String) : []);
  const chosen = (await reorderSuggestions()).filter((s) => pick.has(s.productId));
  if (!chosen.length) throw new UserError("Tick at least one product");
  const missing = chosen.filter((s) => !s.vendorId);
  if (missing.length) throw new UserError(`Give ${missing.map((m) => m.sku).slice(0, 5).join(", ")} a vendor first`);
  const byVendor = new Map<string, typeof chosen>();
  for (const s of chosen) byVendor.set(s.vendorId!, [...(byVendor.get(s.vendorId!) ?? []), s]);
  const out: PurchaseOrder[] = [];
  for (const [vendorId, items] of byVendor) {
    out.push(await createPo(ctx, { vendorId, locationId, lines: items.map((i) => ({ productId: i.productId, qty: i.suggest, unitCost: i.unitCost })) }));
  }
  return out;
}
