import { num, q } from "./db";
import { UserError, round } from "./util";

/**
 * The link to Synergy Commerce, which owns stock for the whole suite. With OPS_COMMERCE_URL and
 * COMMERCE_SVC_TOKEN set:
 * - Ops mirrors each item's quantity on hand and average cost from the Commerce product with the
 *   same SKU, and plans against that.
 * - Materials issued to work orders, finished goods and spare parts used on maintenance are queued
 *   and sent to Commerce in order. Commerce moves the stock and posts the journal to Books (issues
 *   against the work-in-progress account, parts against the maintenance account).
 * - Receiving and counting stock happen in Commerce, not here.
 * Without them Ops keeps its own small stock ledger and nothing is sent anywhere.
 */
export function commerceUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPS_COMMERCE_URL || "").replace(/\/$/, "");
}

export function commerceLinked(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!commerceUrl(env) && !!(env.COMMERCE_SVC_TOKEN || "");
}

/** Refused when Commerce is linked: stock arrives and is counted there. */
export function assertLocalStock(): void {
  if (commerceLinked()) throw new UserError("Stock is kept in Commerce: receive and count it there", 409);
}

const g = globalThis as unknown as { __opsCommerceFetch?: typeof fetch };

/** Swaps the HTTP client, for tests. */
export function setCommerceFetch(f: typeof fetch | undefined): void {
  g.__opsCommerceFetch = f;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const doFetch = g.__opsCommerceFetch ?? fetch;
  const res = await doFetch(`${commerceUrl()}/api/svc/${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.COMMERCE_SVC_TOKEN || ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error || data.message || `Commerce answered ${res.status}`);
  return data as T;
}

/** What each Ops move is called in Commerce, and the account Commerce posts the other side to. */
const KINDS: Record<string, { kind: string; account: () => string }> = {
  issue: { kind: "mfg_issue", account: () => process.env.OPS_WIP_ACCOUNT || "5000" },
  produce: { kind: "mfg_receipt", account: () => process.env.OPS_WIP_ACCOUNT || "5000" },
  maintenance: { kind: "maint_issue", account: () => process.env.OPS_MAINTENANCE_ACCOUNT || "6000" },
};

/** Ops' move kinds that go to Commerce; the rest only happen when Commerce isn't linked. */
export const SYNCED_KINDS = Object.keys(KINDS);

/**
 * Sends queued moves to Commerce, oldest first, stopping at the first failure so Commerce sees
 * them in order. Commerce ignores a reference it already has, so a retry after a timeout is safe.
 */
export async function syncStockMoves(limit = 200): Promise<{ synced: number; failed: number }> {
  if (!commerceLinked()) return { synced: 0, failed: 0 };
  const rows = await q<{ id: string; sku: string; name: string; uom: string; qty: string; unit_cost: string; kind: string; note: string; ref: string }>(
    `SELECT m.id, i.sku, i.name, i.uom, m.qty, m.unit_cost, m.kind, m.note, m.ref FROM stock_moves m JOIN items i ON i.id = m.item_id
     WHERE m.sync_status IN ('pending','failed') ORDER BY m.id LIMIT $1`,
    [limit],
  );
  let synced = 0;
  for (const r of rows) {
    const k = KINDS[r.kind];
    try {
      if (!k) throw new Error(`A ${r.kind} move can't be sent to Commerce`);
      await call("POST", "stock-moves", {
        reference: `ops-move-${r.id}`, sku: r.sku, name: r.name, unit: r.uom, qty: num(r.qty), kind: k.kind, account: k.account(),
        ...(r.kind === "produce" ? { unitCost: num(r.unit_cost) } : {}),
        note: [r.ref, r.note].filter(Boolean).join(" "),
      });
      await q("UPDATE stock_moves SET sync_status = 'synced', sync_error = '' WHERE id = $1", [r.id]);
      synced++;
    } catch (e) {
      await q("UPDATE stock_moves SET sync_status = 'failed', sync_error = $2 WHERE id = $1", [r.id, (e as Error).message.slice(0, 300)]);
      return { synced, failed: 1 };
    }
  }
  return { synced, failed: 0 };
}

export type CommerceItem = { id: string; sku: string; name: string; unit?: string; cost: number; onHand: number };

/**
 * Copies quantity on hand and average cost from Commerce onto Ops' items with the same SKU.
 * Moves Ops has queued but Commerce hasn't taken yet are counted on top, so a refresh never
 * undoes an issue that is still on its way.
 */
export async function refreshStock(): Promise<{ updated: number; missing: string[] }> {
  if (!commerceLinked()) return { updated: 0, missing: [] };
  const mine = await q<{ id: string; sku: string; pending: string }>(
    `SELECT i.id, i.sku, COALESCE((SELECT sum(qty) FROM stock_moves m WHERE m.item_id = i.id AND m.sync_status IN ('pending','failed')), 0) AS pending
     FROM items i WHERE i.active ORDER BY i.id`,
  );
  const bySku = new Map<string, CommerceItem>();
  for (let i = 0; i < mine.length; i += 100) {
    const skus = mine.slice(i, i + 100).map((r) => r.sku);
    const found = await call<CommerceItem[]>("GET", `items?sku=${encodeURIComponent(skus.join(","))}`);
    for (const it of found) bySku.set(it.sku.toLowerCase(), it);
  }
  let updated = 0;
  const missing: string[] = [];
  for (const r of mine) {
    const it = bySku.get(r.sku.toLowerCase());
    if (!it) {
      missing.push(r.sku);
      continue;
    }
    await q("UPDATE items SET on_hand = $2, unit_cost = $3, commerce_id = $4, updated_at = now() WHERE id = $1", [
      r.id, Math.max(0, round(num(it.onHand) + num(r.pending))), num(it.cost), it.id,
    ]);
    updated++;
  }
  return { updated, missing };
}

/** Brings Commerce's products into Ops as bought items; SKUs Ops already has are only linked. */
export async function importFromCommerce(): Promise<{ added: number; linked: number }> {
  if (!commerceLinked()) throw new UserError("Commerce isn't linked: set OPS_COMMERCE_URL and COMMERCE_SVC_TOKEN", 400);
  const items = await call<CommerceItem[]>("GET", "items");
  let added = 0;
  let linked = 0;
  for (const it of items) {
    const rows = await q(
      `INSERT INTO items (sku, name, uom, unit_cost, on_hand, commerce_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ((lower(sku))) DO UPDATE SET commerce_id = EXCLUDED.commerce_id RETURNING (xmax = 0) AS inserted`,
      [it.sku, it.name || it.sku, it.unit || "ea", num(it.cost), Math.max(0, num(it.onHand)), it.id],
    );
    if ((rows[0] as { inserted: boolean }).inserted) added++;
    else linked++;
  }
  return { added, linked };
}

export type StockLink = { linked: boolean; pending: number; failed: number; lastError: string };

export async function stockLink(): Promise<StockLink> {
  if (!commerceLinked()) return { linked: false, pending: 0, failed: 0, lastError: "" };
  const [r] = await q<{ pending: number; failed: number; err: string | null }>(
    `SELECT count(*) FILTER (WHERE sync_status = 'pending')::int AS pending, count(*) FILTER (WHERE sync_status = 'failed')::int AS failed,
       (SELECT sync_error FROM stock_moves WHERE sync_status = 'failed' ORDER BY id LIMIT 1) AS err
     FROM stock_moves WHERE sync_status IN ('pending','failed')`,
  );
  return { linked: true, pending: r.pending, failed: r.failed, lastError: r.err ?? "" };
}
