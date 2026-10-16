import { q } from "./db";
import { call, linked } from "./links";
import { requireStaff } from "./staff";
import { UserError, cents, text } from "./util";
import { access, assertOpen, event } from "./workorders";

/**
 * Parts used on jobs. With Commerce linked (COMMERCE_SVC_TOKEN) parts are picked from its catalog,
 * and each one used is queued and sent to Commerce's /api/svc/stock-moves as a `service_issue`,
 * oldest first: Commerce takes it off the shelf and posts the cost to Books against
 * FIELD_PARTS_ACCOUNT (cost of service parts, 5000 by default). Commerce ignores a reference it
 * has already seen, so sending again after a timeout is safe. Without Commerce parts are only
 * recorded here, for billing.
 */
export function commerceLinked(): boolean {
  return linked("commerce");
}

export type CatalogPart = { sku: string; name: string; unit: string; priceCents: number; onHand: number };

type SvcItem = { id: string; sku: string; name: string; unit: string; cost: string; price?: string; onHand: number };

function toCatalog(i: SvcItem): CatalogPart {
  return { sku: i.sku, name: i.name, unit: i.unit || "each", priceCents: Math.round(Number(i.price ?? 0) * 100), onHand: Number(i.onHand) };
}

export async function searchCatalog(me: string, search: string): Promise<CatalogPart[]> {
  await requireStaff(me);
  if (!commerceLinked()) return [];
  const items = await call<SvcItem[]>("commerce", "GET", `/api/svc/items?q=${encodeURIComponent(text(search, 100))}`);
  return items.slice(0, 50).map(toCatalog);
}

function quantity(v: unknown): number {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1e6) throw new UserError("Quantity must be more than zero");
  return Math.round(n * 1000) / 1000;
}

export async function addPart(me: string, workOrderId: string, b: Record<string, unknown>): Promise<void> {
  await access(me, workOrderId);
  await assertOpen(workOrderId);
  const qty = quantity(b.qty);
  let sku = text(b.sku, 40);
  let name = text(b.name, 200);
  let unit = text(b.unit, 20) || "each";
  let price = cents(b.unitPrice, "Price");
  if (commerceLinked()) {
    if (!sku) throw new UserError("Pick the part from the catalog");
    const [item] = (await call<SvcItem[]>("commerce", "GET", `/api/svc/items?sku=${encodeURIComponent(sku)}`)).map(toCatalog);
    if (!item) throw new UserError(`Commerce has no part ${sku}`, 404);
    sku = item.sku;
    name = item.name;
    unit = item.unit;
    if (price === null) price = item.priceCents;
  } else {
    if (!name) throw new UserError("Name the part");
  }
  await q(
    `INSERT INTO parts (work_order_id, sku, name, unit, qty, unit_price_cents, sync_status, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [workOrderId, sku, name, unit, qty, price ?? 0, commerceLinked() ? "pending" : "local", me],
  );
  await event(q, workOrderId, me, `Used ${qty} ${unit} ${name}`);
  await q("UPDATE work_orders SET modified_at = now() WHERE id = $1", [workOrderId]);
  if (commerceLinked()) await syncParts();
}

/** Parts can be taken back off a job until Commerce has them; after that, return them there. */
export async function removePart(me: string, workOrderId: string, partId: string): Promise<void> {
  await access(me, workOrderId);
  await assertOpen(workOrderId);
  if (!/^\d{1,18}$/.test(partId)) throw new UserError("That part isn't on this job", 404);
  const [p] = await q<{ sync_status: string; name: string; added_by: string }>(
    "SELECT sync_status, name, added_by FROM parts WHERE id = $1 AND work_order_id = $2",
    [partId, workOrderId],
  );
  if (!p) throw new UserError("That part isn't on this job", 404);
  if (p.sync_status === "synced") throw new UserError("Commerce has already taken this part off stock. Return it in Commerce, then add a corrected line.", 409);
  if (p.sync_status === "pending") throw new UserError("This part is on its way to Commerce. Try again in a moment.", 409);
  await q("DELETE FROM parts WHERE id = $1", [partId]);
  await event(q, workOrderId, me, `Removed ${p.name}`);
}

/**
 * Sends queued parts to Commerce in order, stopping at the first failure. Returns how many went
 * and whether one failed (its error is kept on the part).
 */
export async function syncParts(limit = 200): Promise<{ synced: number; failed: number }> {
  if (!commerceLinked()) return { synced: 0, failed: 0 };
  const rows = await q<{ id: string; sku: string; name: string; unit: string; qty: string; number: string }>(
    `SELECT p.id, p.sku, p.name, p.unit, p.qty, w.number FROM parts p JOIN work_orders w ON w.id = p.work_order_id
     WHERE p.sync_status IN ('pending', 'failed') ORDER BY p.id LIMIT $1`,
    [limit],
  );
  let synced = 0;
  for (const r of rows) {
    try {
      const out = await call<{ unitCost?: string }>("commerce", "POST", "/api/svc/stock-moves", {
        reference: `field-part-${r.id}`, sku: r.sku, name: r.name, unit: r.unit, qty: -Number(r.qty), kind: "service_issue",
        account: process.env.FIELD_PARTS_ACCOUNT || "5000", note: `Field service ${r.number}`,
      });
      await q("UPDATE parts SET sync_status = 'synced', sync_error = '', unit_cost = $2 WHERE id = $1", [r.id, out.unitCost ?? null]);
      synced++;
    } catch (e) {
      await q("UPDATE parts SET sync_status = 'failed', sync_error = $2 WHERE id = $1", [r.id, (e as Error).message.slice(0, 300)]);
      return { synced, failed: 1 };
    }
  }
  return { synced, failed: 0 };
}

export async function partsLink(): Promise<{ linked: boolean; pending: number; failed: number; lastError: string }> {
  if (!commerceLinked()) return { linked: false, pending: 0, failed: 0, lastError: "" };
  const [r] = await q<{ pending: number; failed: number; err: string | null }>(
    `SELECT count(*) FILTER (WHERE sync_status = 'pending')::int AS pending, count(*) FILTER (WHERE sync_status = 'failed')::int AS failed,
       (SELECT sync_error FROM parts WHERE sync_status = 'failed' ORDER BY id LIMIT 1) AS err
     FROM parts WHERE sync_status IN ('pending', 'failed')`,
  );
  return { linked: true, pending: r.pending, failed: r.failed, lastError: r.err ?? "" };
}
