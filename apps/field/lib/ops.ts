import { type Asset, saveAsset } from "./customers";
import { q } from "./db";
import { call, linked } from "./links";
import { requireDispatcher } from "./staff";
import { UserError, text } from "./util";

/**
 * The asset register in Synergy Ops (its /api/svc/assets, Bearer OPS_API_TOKEN). Equipment Ops
 * already tracks (make, model, serial, where it is) can be brought onto a customer by its tag
 * instead of being typed in again; the tag stays on the asset so both apps name the same unit.
 */
export type OpsAsset = {
  tag: string; name: string; category: string; location: string; make: string; model: string; serial: string; status: string;
  purchaseDate: string | null;
};

export function opsLinked(): boolean {
  return linked("ops");
}

export async function searchOpsAssets(me: string, search: string): Promise<OpsAsset[]> {
  await requireDispatcher(me);
  if (!opsLinked()) throw new UserError("Ops isn't linked: set OPS_API_TOKEN on both apps", 400);
  return call<OpsAsset[]>("ops", "GET", `/api/svc/assets?q=${encodeURIComponent(text(search, 100))}`);
}

export async function importOpsAsset(me: string, customerId: string, tag: unknown): Promise<Asset> {
  await requireDispatcher(me);
  const t = text(tag, 80);
  if (!t) throw new UserError("Pick an asset from Ops");
  const found = await call<OpsAsset[]>("ops", "GET", `/api/svc/assets?tag=${encodeURIComponent(t)}`);
  const a = found.find((x) => x.tag.toLowerCase() === t.toLowerCase());
  if (!a) throw new UserError(`Ops has no asset tagged ${t}`, 404);
  const [dup] = await q("SELECT 1 FROM assets WHERE customer_id = $1 AND lower(ops_tag) = lower($2) AND held_deleted_at IS NULL", [customerId, a.tag]);
  if (dup) throw new UserError(`${a.tag} is already on this customer`, 409);
  return saveAsset(me, null, {
    customerId, name: a.name, make: a.make, model: a.model, serial: a.serial, location: a.location, installedOn: a.purchaseDate ?? "",
    opsTag: a.tag, notes: a.category ? `Ops category: ${a.category}` : "",
  });
}
