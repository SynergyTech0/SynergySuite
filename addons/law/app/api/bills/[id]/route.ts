import { type Params, route } from "@/lib/api";
import { cancelBill } from "@/lib/billing";

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await cancelBill(me, (await params).id);
  return { ok: true };
});
