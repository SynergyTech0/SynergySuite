import { type Params, body, route } from "@/lib/api";
import { deleteWorkOrder, getWorkOrder, updateWorkOrder } from "@/lib/workorders";

export const GET = route(async (me, _req, { params }: Params<"id">) => getWorkOrder(me.email, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateWorkOrder(me.email, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteWorkOrder(me.email, (await params).id);
});
