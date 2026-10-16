import { q, num } from "./db";
import { UserError } from "./util";

/**
 * The link to Synergy Books. With OPS_BOOKS_URL and BOOKS_SVC_TOKEN set, every stock move is
 * queued for Books (its inventory ledger and stock value), assets can be sent to its fixed-asset
 * register (Books depreciates them), and items can be brought over from it. Without them Ops
 * works on its own and nothing is queued.
 */
export function booksUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPS_BOOKS_URL || "").replace(/\/$/, "");
}

export function booksLinked(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!booksUrl(env) && !!(env.BOOKS_SVC_TOKEN || "");
}

const g = globalThis as unknown as { __opsBooksFetch?: typeof fetch };

/** Swaps the HTTP client, for tests. */
export function setBooksFetch(f: typeof fetch | undefined): void {
  g.__opsBooksFetch = f;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const doFetch = g.__opsBooksFetch ?? fetch;
  const res = await doFetch(`${booksUrl()}/api/svc/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.BOOKS_SVC_TOKEN || ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join("; ") : data.message;
    throw new Error(msg || `Books answered ${res.status}`);
  }
  return data as T;
}

/**
 * Sends queued stock moves to Books, oldest first, stopping at the first failure so Books sees
 * them in order. Books ignores a move it already has, so a retry after a timeout is safe.
 */
export async function syncStockMoves(limit = 200): Promise<{ synced: number; failed: number }> {
  if (!booksLinked()) return { synced: 0, failed: 0 };
  const rows = await q<{ id: string; sku: string; name: string; qty: string; unit_cost: string; kind: string; note: string; ref: string }>(
    `SELECT m.id, i.sku, i.name, m.qty, m.unit_cost, m.kind, m.note, m.ref FROM stock_moves m JOIN items i ON i.id = m.item_id
     WHERE m.books_status IN ('pending','failed') ORDER BY m.id LIMIT $1`,
    [limit],
  );
  let synced = 0;
  for (const r of rows) {
    try {
      await call("POST", "stock-moves", {
        ref: `ops-move-${r.id}`, sku: r.sku, name: r.name, qty: num(r.qty), unitCost: num(r.unit_cost), kind: r.kind,
        note: [r.ref, r.note].filter(Boolean).join(" "),
      });
      await q("UPDATE stock_moves SET books_status = 'synced', books_error = '' WHERE id = $1", [r.id]);
      synced++;
    } catch (e) {
      await q("UPDATE stock_moves SET books_status = 'failed', books_error = $2 WHERE id = $1", [r.id, (e as Error).message.slice(0, 300)]);
      return { synced, failed: 1 };
    }
  }
  return { synced, failed: 0 };
}

/** Sends one asset to Books' fixed-asset register, or updates it there. */
export async function sendAsset(id: number): Promise<{ booksAssetId: string }> {
  if (!booksLinked()) throw new UserError("Books isn't linked: set OPS_BOOKS_URL and BOOKS_SVC_TOKEN", 400);
  const [a] = await q<Record<string, unknown>>("SELECT * FROM assets WHERE id = $1", [id]);
  if (!a) throw new UserError("Asset not found", 404);
  if (!a.purchase_cost || !a.purchase_date || !a.useful_life_months) {
    throw new UserError("Add the purchase date, cost and useful life first; Books needs them to depreciate the asset", 400);
  }
  try {
    const r = await call<{ id: string }>("POST", "fixed-assets", {
      ref: `ops-asset-${a.id}`, tag: a.tag, name: a.name, category: a.category, acquisitionDate: a.purchase_date, cost: num(a.purchase_cost),
      salvage: num(a.salvage_value), lifeMonths: Number(a.useful_life_months), location: a.location, serial: a.serial, model: a.model,
      manufacturer: a.make, assignedTo: a.assignee,
    });
    await q("UPDATE assets SET books_asset_id = $2, books_error = '', updated_at = now() WHERE id = $1", [id, r.id]);
    return { booksAssetId: r.id };
  } catch (e) {
    await q("UPDATE assets SET books_error = $2 WHERE id = $1", [id, (e as Error).message.slice(0, 300)]);
    throw new UserError(`Books didn't take it: ${(e as Error).message}`, 502);
  }
}

export type BooksItem = { id: string; sku: string; name: string; description: string; unitCost: number; quantity: number; reorderPoint: number };

/**
 * Brings Books' inventory items into Ops. New SKUs arrive as bought items with Books' quantity as
 * opening stock; SKUs Ops already has only get linked, since Ops counts its own stock from then on.
 */
export async function importFromBooks(): Promise<{ added: number; linked: number }> {
  if (!booksLinked()) throw new UserError("Books isn't linked: set OPS_BOOKS_URL and BOOKS_SVC_TOKEN", 400);
  const items = await call<BooksItem[]>("GET", "items");
  let added = 0;
  let linked = 0;
  for (const it of items) {
    const [mine] = await q<{ id: string }>("SELECT id FROM items WHERE lower(sku) = lower($1)", [it.sku]);
    if (mine) {
      await q("UPDATE items SET books_item_id = $2 WHERE id = $1", [mine.id, it.id]);
      linked++;
      continue;
    }
    // Opening stock is Books' own count, so it is not sent back as a move.
    await q(
      `INSERT INTO items (sku, name, description, unit_cost, on_hand, reorder_point, books_item_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [it.sku, it.name || it.sku, it.description || "", it.unitCost || 0, Math.max(0, it.quantity || 0), it.reorderPoint || 0, it.id],
    );
    added++;
  }
  return { added, linked };
}

export async function booksStatus(): Promise<{ linked: boolean; pending: number; failed: number; lastError: string }> {
  if (!booksLinked()) return { linked: false, pending: 0, failed: 0, lastError: "" };
  const [r] = await q<{ pending: number; failed: number; err: string | null }>(
    `SELECT count(*) FILTER (WHERE books_status = 'pending')::int AS pending, count(*) FILTER (WHERE books_status = 'failed')::int AS failed,
       (SELECT books_error FROM stock_moves WHERE books_status = 'failed' ORDER BY id LIMIT 1) AS err
     FROM stock_moves WHERE books_status IN ('pending','failed')`,
  );
  return { linked: true, pending: r.pending, failed: r.failed, lastError: r.err ?? "" };
}
