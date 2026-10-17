import { type Params, body, route } from "@/lib/api";
import { complete } from "@/lib/schedule";
import { getWorkOrder } from "@/lib/workorders";

/** Finishes the job: { resolution, signedBy?, signature? (PNG data URL) } */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await complete(me.email, id, await body(req));
  return getWorkOrder(me.email, id);
});
