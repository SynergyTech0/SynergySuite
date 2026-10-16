import { body, idOf, route, type Params } from "@/lib/api";
import { getOrder, updateOrder } from "@/lib/assets";

export const GET = route(async (_me, _req, { params }: Params<"id">) => getOrder(idOf((await params).id)));
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const id = idOf((await params).id);
  await updateOrder(id, await body(req), me.email);
  return getOrder(id);
});
