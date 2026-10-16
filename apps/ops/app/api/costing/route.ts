import { route } from "@/lib/api";
import { costing } from "@/lib/mfg";
import { UserError } from "@/lib/util";

/** ?item=<id>&qty=<n>: standard cost and the full parts list with shortages. */
export const GET = route(async (_me, req) => {
  const sp = new URL(req.url).searchParams;
  const item = Number(sp.get("item"));
  const qty = Number(sp.get("qty") || 1);
  if (!Number.isSafeInteger(item) || item <= 0) throw new UserError("Pick an item");
  if (!Number.isFinite(qty) || qty <= 0) throw new UserError("Quantity must be more than 0");
  return costing(item, qty);
});
