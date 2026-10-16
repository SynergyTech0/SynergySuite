import { num, q } from "./db";
import { UserError } from "./util";

/**
 * The link to Synergy Books, for fixed assets only: with OPS_BOOKS_URL and BOOKS_SVC_TOKEN set,
 * an asset can be sent to Books' fixed-asset register, where Books depreciates it. Stock value
 * reaches Books through Commerce (see commerce.ts).
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
