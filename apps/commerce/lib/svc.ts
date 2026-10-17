/**
 * The service API other suite apps use to read and move stock (`/api/svc/*`, Bearer
 * COMMERCE_SVC_TOKEN). Operations plans production and maintenance from these numbers and sends
 * every part it uses and every product it makes back through `stockMove`, and Field Service sends
 * the parts its technicians use on jobs, so Commerce stays the one stock ledger and Books hears
 * about each move once.
 */
import { timingSafeEqual } from "node:crypto";
import { q, tx } from "./db";
import { enqueue, offsetLines } from "./books";
import { qty as roundQty, round4 } from "./money";
import { getSettings } from "./settings";
import { move } from "./stock";
import type { MovementKind } from "./types";
import { UserError, isUuid, quantity, text } from "./util";

/** True when the request carries `Authorization: Bearer <COMMERCE_SVC_TOKEN>`. */
export function svcAuthorized(header: string | null, token = process.env.COMMERCE_SVC_TOKEN || ""): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SvcItem = {
  id: string; sku: string; name: string; unit: string; cost: string; price: string; onHand: number;
  byLocation: { locationId: string; onHand: number }[];
};

/** Active products by search term or by an exact list of SKUs (`skus`), with price and stock by location. */
export async function svcItems(f: { q?: string; skus?: string[] } = {}): Promise<SvcItem[]> {
  const where = ["p.active"];
  const args: unknown[] = [];
  if (f.skus?.length) {
    args.push(f.skus.slice(0, 500).map((s) => s.toLowerCase()));
    where.push(`lower(p.sku) = ANY($${args.length})`);
  } else if (f.q?.trim()) {
    args.push(`%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(p.sku ILIKE $${args.length} OR p.name ILIKE $${args.length} OR p.barcode = $${args.length})`);
  }
  const rows = await q<{ id: string; sku: string; name: string; unit: string; cost: string; price: string; levels: { l: string; n: string }[] | null }>(
    `SELECT p.id, p.sku, p.name, p.unit, p.cost, p.price,
            (SELECT json_agg(json_build_object('l', s.location_id, 'n', s.on_hand) ORDER BY s.location_id)
               FROM stock s WHERE s.product_id = p.id) AS levels
     FROM products p WHERE ${where.join(" AND ")} ORDER BY p.sku LIMIT 500`,
    args,
  );
  return rows.map((r) => {
    const byLocation = (r.levels ?? []).map((x) => ({ locationId: x.l, onHand: Number(x.n) }));
    return {
      id: r.id, sku: r.sku, name: r.name, unit: r.unit, cost: Number(r.cost).toFixed(4), price: Number(r.price).toFixed(2),
      onHand: roundQty(byLocation.reduce((a, x) => a + x.onHand, 0)), byLocation,
    };
  });
}

export async function svcLocations(): Promise<{ id: string; name: string; kind: string }[]> {
  return q("SELECT id, name, kind FROM locations WHERE active ORDER BY created_at");
}

const SVC_KINDS = ["mfg_issue", "mfg_receipt", "maint_issue", "service_issue"] as const;
type SvcKind = (typeof SVC_KINDS)[number];
const KIND_TEXT: Record<SvcKind, string> = {
  mfg_issue: "Used in production", mfg_receipt: "Made", maint_issue: "Used in maintenance", service_issue: "Used on a service job",
};

export type StockMoveInput = {
  reference?: unknown; sku?: unknown; name?: unknown; unit?: unknown; locationId?: unknown; qty?: unknown; unitCost?: unknown; kind?: unknown; account?: unknown; note?: unknown;
};
export type StockMoveResult = { duplicate?: true; onHand: number; unitCost: string };

/**
 * One part used (negative qty: `mfg_issue`, `maint_issue`, or `service_issue` for Field Service) or one product made (positive qty,
 * `mfg_receipt`). Issues are valued at average cost; receipts at the `unitCost` sent, which moves
 * the average. The value is posted to Books against `account` (by default the stock adjustment
 * account). `onHand` is what is left at that location afterwards. A receipt of a SKU Commerce
 * hasn't seen yet (a new product Operations makes) creates it from `name` and `unit`, stock-tracked,
 * unpriced and off the online store until someone prices it.
 */
export async function stockMove(input: StockMoveInput): Promise<StockMoveResult> {
  const reference = text(input.reference, 180);
  if (!reference) throw new UserError("reference is required");
  const kind = input.kind as SvcKind;
  if (!SVC_KINDS.includes(kind)) throw new UserError("kind must be mfg_issue, mfg_receipt, maint_issue or service_issue");
  const n = quantity(input.qty, "qty", false);
  if (n === 0) throw new UserError("qty can't be zero");
  if (kind === "mfg_receipt" ? n < 0 : n > 0) {
    throw new UserError(kind === "mfg_receipt" ? "A receipt adds stock: send a positive qty" : "An issue takes stock: send a negative qty");
  }
  let unitCost: number | undefined;
  if (input.unitCost !== undefined && input.unitCost !== null && input.unitCost !== "") {
    const c = Number(input.unitCost);
    if (!Number.isFinite(c) || c < 0 || c > 1e9) throw new UserError("unitCost must be a positive amount");
    unitCost = round4(c);
  }
  const note = text(input.note, 300);
  const settings = await getSettings();
  const account = text(input.account, 20) || settings.accounts.shrinkage;
  const sku = text(input.sku, 40);

  return tx(async (tq) => {
    const [done] = await tq<{ on_hand: string; unit_cost: string }>("SELECT on_hand, unit_cost FROM svc_moves WHERE reference = $1", [reference]);
    if (done) return { duplicate: true, onHand: Number(done.on_hand), unitCost: Number(done.unit_cost).toFixed(4) };

    if (!sku) throw new UserError("sku is required");
    let [p] = await tq<{ id: string; sku: string; track_stock: boolean; active: boolean }>(
      "SELECT id, sku, track_stock, active FROM products WHERE lower(sku) = lower($1)", [sku],
    );
    if (!p && kind === "mfg_receipt") {
      const name = text(input.name, 200);
      if (!name) throw new UserError(`No product with SKU ${sku}; send its name to create it`, 404);
      [p] = await tq<{ id: string; sku: string; track_stock: boolean; active: boolean }>(
        `INSERT INTO products (sku, name, unit, price, track_stock, online, created_by) VALUES ($1, $2, $3, 0, true, false, 'operations')
         RETURNING id, sku, track_stock, active`,
        [sku, name, text(input.unit, 20) || "each"],
      );
    }
    if (!p) throw new UserError(`No product with SKU ${sku}`, 404);
    if (!p.track_stock) throw new UserError(`${p.sku} isn't stock-tracked`);

    let locationId: string;
    if (input.locationId !== undefined && input.locationId !== null && input.locationId !== "") {
      if (!isUuid(input.locationId)) throw new UserError("locationId isn't a location");
      const [l] = await tq("SELECT 1 FROM locations WHERE id = $1 AND active", [input.locationId]);
      if (!l) throw new UserError("That location is not in use");
      locationId = input.locationId;
    } else {
      const [l] = await tq<{ id: string }>("SELECT id FROM locations WHERE active ORDER BY created_at LIMIT 1");
      if (!l) throw new UserError("There is no location to move stock at");
      locationId = l.id;
    }

    // Lock the product first (as move() does) so two issues can't both see the last unit.
    await tq("SELECT 1 FROM products WHERE id = $1 FOR UPDATE", [p.id]);
    const [s] = await tq<{ on_hand: string }>("SELECT on_hand FROM stock WHERE product_id = $1 AND location_id = $2", [p.id, locationId]);
    const before = Number(s?.on_hand ?? 0);
    if (before + n < 0) throw new UserError(`Only ${roundQty(before)} of ${p.sku} on hand there; can't take ${roundQty(-n)}`, 409);

    const cost = await move(tq, {
      productId: p.id, locationId, qty: n, kind: kind as MovementKind, unitCost: kind === "mfg_receipt" ? unitCost : undefined,
      refType: "svc", refId: reference, note, by: "operations",
    });
    const onHand = roundQty(before + n);
    await tq("INSERT INTO svc_moves (reference, product_id, qty, unit_cost, on_hand) VALUES ($1, $2, $3, $4, $5)", [reference, p.id, n, cost, onHand]);
    const description = `${KIND_TEXT[kind]}: ${p.sku} ${n > 0 ? "+" : ""}${n}${note ? ` (${note})` : ""}`;
    await enqueue(tq, {
      reference: `commerce:svc:${reference}`,
      kind: "adjustment",
      date: new Date().toISOString().slice(0, 10),
      description,
      lines: offsetLines(settings, account, Math.round(n * cost * 100), description),
    });
    return { onHand, unitCost: Number(cost).toFixed(4) };
  });
}
