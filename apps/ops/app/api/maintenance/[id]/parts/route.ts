import { body, idOf, route, type Params } from "@/lib/api";
import { addPart, getOrder } from "@/lib/assets";

/** Takes a spare part from stock for this job. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const id = idOf((await params).id);
  await addPart(id, await body(req), me.email);
  return getOrder(id);
});
