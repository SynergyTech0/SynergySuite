import { body, route } from "@/lib/api";
import { createWorkOrder, getWorkOrder, listWorkOrders } from "@/lib/mfg";

export const GET = route(async (me, req) => {
  const sp = new URL(req.url).searchParams;
  return listWorkOrders({ status: sp.get("status") || undefined, q: sp.get("q") || undefined, mine: sp.get("mine") === "1" ? me.email : undefined });
});

export const POST = route(async (me, req) => getWorkOrder(await createWorkOrder(await body(req), me.email)));
