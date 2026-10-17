import { body, route } from "@/lib/api";
import { createWorkOrder, listWorkOrders } from "@/lib/workorders";

/** ?status= ?open=1 ?q= ?customer= ?asset= */
export const GET = route(async (me, req) => {
  const p = new URL(req.url).searchParams;
  return listWorkOrders(me.email, {
    status: p.get("status") ?? undefined, open: p.get("open") === "1", q: p.get("q") ?? undefined,
    customerId: p.get("customer") ?? undefined, assetId: p.get("asset") ?? undefined,
  });
});

export const POST = route(async (me, req) => createWorkOrder(me.email, await body(req)));
