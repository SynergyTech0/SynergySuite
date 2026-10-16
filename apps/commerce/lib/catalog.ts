/** Products, locations and vendors: what is sold, where it is kept, and who it is bought from. */
import { q, tx } from "./db";
import { assertManager } from "./members";
import { fromCents } from "./money";
import type { Ctx, Location, Product, StockLevel, Vendor } from "./types";
import { UserError, bool, cents, isUuid, likeTerm, optionalEmail, optionalUrl, quantity, rate, required, text } from "./util";

// ---------- locations

type LocRow = { id: string; name: string; kind: Location["kind"]; address: string; active: boolean };
const toLoc = (r: LocRow): Location => ({ id: r.id, name: r.name, kind: r.kind, address: r.address, active: r.active });

export async function locations(): Promise<Location[]> {
  return (await q<LocRow>("SELECT * FROM locations ORDER BY active DESC, created_at")).map(toLoc);
}

export async function saveLocation(ctx: Ctx, id: string | null, input: Record<string, unknown>): Promise<Location> {
  assertManager(ctx);
  const name = required(input.name, "Name", 80);
  const kind = input.kind === "warehouse" ? "warehouse" : "store";
  const address = text(input.address, 300);
  const active = input.active === undefined ? true : bool(input.active);
  if (!id) {
    const [r] = await q<LocRow>("INSERT INTO locations (name, kind, address) VALUES ($1, $2, $3) RETURNING *", [name, kind, address]);
    return toLoc(r);
  }
  if (!active) {
    const [busy] = await q("SELECT 1 FROM registers WHERE location_id = $1 AND active", [id]);
    if (busy) throw new UserError("Move or turn off this location's registers first");
  }
  const [r] = await q<LocRow>("UPDATE locations SET name = $2, kind = $3, address = $4, active = $5 WHERE id = $1 RETURNING *", [id, name, kind, address, active]);
  if (!r) throw new UserError("Location not found", 404);
  return toLoc(r);
}

export async function assertLocation(id: unknown): Promise<string> {
  if (!isUuid(id)) throw new UserError("Pick a location");
  const [r] = await q("SELECT 1 FROM locations WHERE id = $1 AND active", [id]);
  if (!r) throw new UserError("That location is not in use");
  return id;
}

// ---------- vendors

type VendorRow = { id: string; name: string; email: string; phone: string; address: string; notes: string; lead_days: number; active: boolean };
const toVendor = (r: VendorRow): Vendor => ({
  id: r.id, name: r.name, email: r.email, phone: r.phone, address: r.address, notes: r.notes, leadDays: r.lead_days, active: r.active,
});

export async function vendors(): Promise<Vendor[]> {
  return (await q<VendorRow>("SELECT * FROM vendors ORDER BY active DESC, lower(name)")).map(toVendor);
}

export async function saveVendor(ctx: Ctx, id: string | null, input: Record<string, unknown>): Promise<Vendor> {
  assertManager(ctx);
  const leadDays = input.leadDays === undefined || input.leadDays === "" ? 7 : Number(input.leadDays);
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) throw new UserError("Lead time must be a whole number of days");
  const vals = [
    required(input.name, "Name", 120), optionalEmail(input.email), text(input.phone, 40), text(input.address, 300), text(input.notes, 2000),
    leadDays, input.active === undefined ? true : bool(input.active),
  ];
  const [r] = id
    ? await q<VendorRow>(
        "UPDATE vendors SET name = $2, email = $3, phone = $4, address = $5, notes = $6, lead_days = $7, active = $8 WHERE id = $1 RETURNING *",
        [id, ...vals],
      )
    : await q<VendorRow>(
        "INSERT INTO vendors (name, email, phone, address, notes, lead_days, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        vals,
      );
  if (!r) throw new UserError("Vendor not found", 404);
  return toVendor(r);
}

// ---------- products

export type ProductRow = {
  id: string; sku: string; barcode: string; name: string; description: string; category: string; unit: string;
  price: string; cost: string; tax_rate: string | null; track_stock: boolean; reorder_point: string; reorder_qty: string;
  vendor_id: string | null; vendor_name: string | null; vendor_sku: string; image_url: string; online: boolean; active: boolean;
  on_hand: string; modified_at: Date;
};

export const PRODUCT_SELECT = `SELECT p.*, v.name AS vendor_name,
  COALESCE((SELECT sum(s.on_hand) FROM stock s WHERE s.product_id = p.id), 0) AS on_hand
  FROM products p LEFT JOIN vendors v ON v.id = p.vendor_id`;

export const toProduct = (r: ProductRow): Product => ({
  id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, description: r.description, category: r.category, unit: r.unit,
  price: Number(r.price).toFixed(2), cost: Number(r.cost).toFixed(2), taxRate: r.tax_rate === null ? null : String(Number(r.tax_rate)),
  trackStock: r.track_stock, reorderPoint: Number(r.reorder_point), reorderQty: Number(r.reorder_qty),
  vendorId: r.vendor_id, vendorName: r.vendor_name, vendorSku: r.vendor_sku, imageUrl: r.image_url, online: r.online, active: r.active,
  onHand: Number(r.on_hand), modifiedAt: r.modified_at.toISOString(),
});

export type ProductFilter = { q?: string; category?: string; status?: "active" | "archived" | "low" | "online" | "all"; limit?: number };

export async function products(f: ProductFilter = {}): Promise<Product[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  const status = f.status ?? "active";
  if (status === "archived") where.push("NOT p.active");
  else if (status !== "all") where.push("p.active");
  if (status === "online") where.push("p.online");
  if (status === "low") where.push("p.track_stock AND p.reorder_point > 0 AND COALESCE((SELECT sum(s.on_hand) FROM stock s WHERE s.product_id = p.id), 0) <= p.reorder_point");
  if (f.category) {
    params.push(f.category);
    where.push(`p.category = $${params.length}`);
  }
  const term = text(f.q, 100);
  if (term) {
    params.push(likeTerm(term), term);
    where.push(`(p.name ILIKE $${params.length - 1} OR p.sku ILIKE $${params.length - 1} OR p.category ILIKE $${params.length - 1} OR p.barcode = $${params.length})`);
  }
  params.push(Math.min(f.limit ?? 500, 2000));
  const rows = await q<ProductRow>(
    `${PRODUCT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY lower(p.name), p.sku LIMIT $${params.length}`,
    params,
  );
  return rows.map(toProduct);
}

export async function product(id: string): Promise<Product & { levels: StockLevel[] }> {
  if (!isUuid(id)) throw new UserError("Product not found", 404);
  const [r] = await q<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  if (!r) throw new UserError("Product not found", 404);
  return { ...toProduct(r), levels: await levels(id) };
}

/** A barcode scan or typed code at the register: exact barcode, then exact SKU. */
export async function lookup(code: string): Promise<Product | null> {
  const c = text(code, 100);
  if (!c) return null;
  const [r] = await q<ProductRow>(
    `${PRODUCT_SELECT} WHERE p.active AND (p.barcode = $1 OR lower(p.sku) = lower($1)) ORDER BY (p.barcode = $1) DESC LIMIT 1`,
    [c],
  );
  return r ? toProduct(r) : null;
}

export async function levels(productId: string): Promise<StockLevel[]> {
  const rows = await q<{ location_id: string; name: string; on_hand: string }>(
    `SELECT l.id AS location_id, l.name, COALESCE(s.on_hand, 0) AS on_hand
     FROM locations l LEFT JOIN stock s ON s.location_id = l.id AND s.product_id = $1
     WHERE l.active OR s.on_hand <> 0 ORDER BY l.created_at`,
    [productId],
  );
  return rows.map((r) => ({ locationId: r.location_id, locationName: r.name, onHand: Number(r.on_hand) }));
}

export async function categories(): Promise<string[]> {
  return (await q<{ category: string }>("SELECT DISTINCT category FROM products WHERE category <> '' AND active ORDER BY category")).map((r) => r.category);
}

const SKU = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;

/** Creates or changes a product. Cost is set here only for a new product; after that receipts move it. */
export async function saveProduct(ctx: Ctx, id: string | null, input: Record<string, unknown>): Promise<Product> {
  assertManager(ctx);
  const sku = required(input.sku, "SKU", 40);
  if (!SKU.test(sku)) throw new UserError("A SKU uses letters, numbers, dots, dashes and slashes");
  const vendorId = input.vendorId ? String(input.vendorId) : null;
  if (vendorId) {
    const [v] = await q("SELECT 1 FROM vendors WHERE id = $1", [isUuid(vendorId) ? vendorId : null]);
    if (!v) throw new UserError("Pick a vendor from the list");
  }
  const reorderPoint = input.reorderPoint === undefined || input.reorderPoint === "" ? 0 : quantity(input.reorderPoint, "Reorder point", false);
  const reorderQty = input.reorderQty === undefined || input.reorderQty === "" ? 0 : quantity(input.reorderQty, "Reorder quantity", false);
  if (reorderPoint < 0 || reorderQty < 0) throw new UserError("Reorder amounts can't be negative");
  const vals = [
    sku, text(input.barcode, 64), required(input.name, "Name", 160), text(input.description, 5000), text(input.category, 60),
    text(input.unit, 16) || "each", fromCents(cents(input.price, "Price")), rate(input.taxRate),
    input.trackStock === undefined ? true : bool(input.trackStock), reorderPoint, reorderQty, vendorId, text(input.vendorSku, 60),
    optionalUrl(input.imageUrl), bool(input.online), input.active === undefined ? true : bool(input.active),
  ];
  return tx(async (tq) => {
    let row: { id: string } | undefined;
    if (id) {
      [row] = await tq<{ id: string }>(
        `UPDATE products SET sku = $2, barcode = $3, name = $4, description = $5, category = $6, unit = $7, price = $8, tax_rate = $9,
           track_stock = $10, reorder_point = $11, reorder_qty = $12, vendor_id = $13, vendor_sku = $14, image_url = $15, online = $16,
           active = $17, modified_at = now()
         WHERE id = $1 RETURNING id`,
        [id, ...vals],
      );
      if (!row) throw new UserError("Product not found", 404);
    } else {
      [row] = await tq<{ id: string }>(
        `INSERT INTO products (sku, barcode, name, description, category, unit, price, tax_rate, track_stock, reorder_point, reorder_qty,
           vendor_id, vendor_sku, image_url, online, active, cost, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [...vals, fromCents(cents(input.cost, "Cost")), ctx.email],
      );
    }
    const [r] = await tq<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [row.id]);
    return toProduct(r);
  });
}

/** A product that was never stocked or sold goes for good; anything with history is archived instead. */
export async function deleteProduct(ctx: Ctx, id: string): Promise<{ archived: boolean }> {
  assertManager(ctx);
  if (!isUuid(id)) throw new UserError("Product not found", 404);
  return tx(async (tq) => {
    const [used] = await tq(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM movements WHERE product_id = $1) OR EXISTS (SELECT 1 FROM order_lines WHERE product_id = $1)
         OR EXISTS (SELECT 1 FROM po_lines WHERE product_id = $1)`,
      [id],
    );
    if (used) {
      await tq("UPDATE products SET active = false, online = false, modified_at = now() WHERE id = $1", [id]);
      return { archived: true };
    }
    await tq("DELETE FROM products WHERE id = $1", [id]);
    return { archived: false };
  });
}

/** Imports products from rows of a CSV the person pasted or uploaded: new SKUs are added, known ones updated. */
export async function importProducts(ctx: Ctx, rows: Record<string, string>[]): Promise<{ added: number; updated: number; errors: string[] }> {
  assertManager(ctx);
  if (!Array.isArray(rows) || rows.length > 5000) throw new UserError("Import up to 5,000 products at a time");
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const sku = text(r.sku ?? r.SKU, 40);
      const [existing] = await q<{ id: string }>("SELECT id FROM products WHERE lower(sku) = lower($1)", [sku]);
      const cur = existing ? await product(existing.id) : null;
      await saveProduct(ctx, existing?.id ?? null, {
        sku,
        name: r.name ?? r.Name ?? cur?.name,
        barcode: r.barcode ?? cur?.barcode,
        category: r.category ?? cur?.category,
        description: r.description ?? cur?.description,
        unit: r.unit ?? cur?.unit,
        price: r.price ?? cur?.price,
        cost: r.cost,
        taxRate: r.tax_rate ?? r.taxRate ?? cur?.taxRate ?? "",
        reorderPoint: r.reorder_point ?? cur?.reorderPoint,
        reorderQty: r.reorder_qty ?? cur?.reorderQty,
        vendorSku: r.vendor_sku ?? cur?.vendorSku,
        vendorId: cur?.vendorId ?? null,
        imageUrl: r.image_url ?? cur?.imageUrl,
        online: r.online !== undefined ? /^(1|true|yes|y)$/i.test(r.online) : cur?.online,
        trackStock: cur?.trackStock ?? true,
      });
      if (existing) updated++;
      else added++;
    } catch (e) {
      errors.push(`Row ${i + 2}: ${(e as Error).message}`);
      if (errors.length >= 50) break;
    }
  }
  return { added, updated, errors };
}
