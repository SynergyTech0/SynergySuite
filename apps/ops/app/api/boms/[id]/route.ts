import { body, idOf, route, type Params } from "@/lib/api";
import { costing, deleteBom, getBom, saveBom, setBomStatus } from "@/lib/mfg";

export const GET = route(async (_me, _req, { params }: Params<"id">) => {
  const bom = await getBom(idOf((await params).id));
  return { bom, cost: bom.status === "active" ? await costing(bom.itemId, bom.outputQty) : null };
});

/** Saves a draft's components and routing. */
export const PUT = route(async (me, req, { params }: Params<"id">) => saveBom(idOf((await params).id), await body(req), me.email));

/** { status }: activate a draft or retire a bill. */
export const PATCH = route(async (_me, req, { params }: Params<"id">) => setBomStatus(idOf((await params).id), (await body(req)).status));

export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await deleteBom(idOf((await params).id));
  return { ok: true };
});
