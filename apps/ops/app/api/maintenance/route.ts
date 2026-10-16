import { body, route } from "@/lib/api";
import { createOrder, getOrder, listOrders } from "@/lib/assets";

export const GET = route(async (me, req) => {
  const sp = new URL(req.url).searchParams;
  return listOrders({ status: sp.get("status") || undefined, q: sp.get("q") || undefined, mine: sp.get("mine") === "1" ? me.email : undefined });
});

export const POST = route(async (me, req) => getOrder(await createOrder(await body(req), me.email)));
