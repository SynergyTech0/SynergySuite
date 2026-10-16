import { body, idOf, route, type Params } from "@/lib/api";
import { actOnPurchaseRequest } from "@/lib/mfg";

/** { action: ordered | receive | cancel, qty?, unitCost?, vendor?, reference? } */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  await actOnPurchaseRequest(idOf((await params).id), await body(req), me.email);
  return { ok: true };
});
