import { body, route } from "@/lib/api";
import { createPo, purchaseOrders } from "@/lib/purchasing";

export const GET = route(async (_ctx, req) => {
  const u = new URL(req.url).searchParams;
  return purchaseOrders({ status: u.get("status") ?? "", vendorId: u.get("vendor") ?? "", q: u.get("q") ?? "" });
});
export const POST = route(async (ctx, req) => createPo(ctx, await body(req)));
