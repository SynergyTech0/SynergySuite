import { body, route, type Params } from "@/lib/api";
import { deleteShift, updateShift } from "@/lib/shifts";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateShift(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteShift(me, (await params).id);
  return { ok: true };
});
