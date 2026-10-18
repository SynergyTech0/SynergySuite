import { body, route, type Params } from "@/lib/api";
import { deletePosition, updatePosition } from "@/lib/shifts";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updatePosition(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deletePosition(me, (await params).id);
  return { ok: true };
});
