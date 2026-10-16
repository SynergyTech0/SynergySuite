import { body, idOf, route, type Params } from "@/lib/api";
import { deletePlan, savePlan } from "@/lib/assets";

export const PATCH = route(async (me, req, { params }: Params<"id">) => savePlan(idOf((await params).id), await body(req), me.email));
export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await deletePlan(idOf((await params).id));
  return { ok: true };
});
