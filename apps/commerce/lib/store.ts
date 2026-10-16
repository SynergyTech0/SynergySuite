/** The online store's view of the catalog: only published products, and nothing about cost or vendors. */
import { q } from "./db";
import { getSettings, taxRateFor } from "./settings";
import { isUuid, likeTerm, text } from "./util";

export type StoreProduct = {
  id: string; sku: string; name: string; description: string; category: string; price: string; taxRate: number;
  imageUrl: string; unit: string;
  /** null when the product isn't stock-tracked (always available). */
  available: number | null;
};

type Row = {
  id: string; sku: string; name: string; description: string; category: string; price: string; tax_rate: string | null; image_url: string; unit: string;
  track_stock: boolean; on_hand: string | null;
};

export async function storeProducts(f: { ids?: string[]; q?: string; category?: string; sku?: string } = {}): Promise<StoreProduct[]> {
  const s = await getSettings();
  if (!s.store.enabled) return [];
  const params: unknown[] = [s.store.locationId];
  const where = ["p.active", "p.online"];
  if (f.ids) {
    params.push(f.ids.filter(isUuid));
    where.push(`p.id = ANY($${params.length}::uuid[])`);
  }
  if (f.sku) {
    params.push(f.sku);
    where.push(`lower(p.sku) = lower($${params.length})`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`p.category = $${params.length}`);
  }
  const term = text(f.q, 80);
  if (term) {
    params.push(likeTerm(term));
    where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR p.category ILIKE $${params.length})`);
  }
  const rows = await q<Row>(
    `SELECT p.id, p.sku, p.name, p.description, p.category, p.price, p.tax_rate, p.image_url, p.unit, p.track_stock,
       (SELECT on_hand FROM stock WHERE product_id = p.id AND location_id = $1) AS on_hand
     FROM products p WHERE ${where.join(" AND ")} ORDER BY p.category, lower(p.name) LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    id: r.id, sku: r.sku, name: r.name, description: r.description, category: r.category, price: Number(r.price).toFixed(2),
    taxRate: taxRateFor(r, s), imageUrl: r.image_url, unit: r.unit, available: r.track_stock ? Math.max(0, Number(r.on_hand ?? 0)) : null,
  }));
}

export async function storeCategories(): Promise<string[]> {
  const rows = await q<{ category: string }>("SELECT DISTINCT category FROM products WHERE active AND online AND category <> '' ORDER BY category");
  return rows.map((r) => r.category);
}
