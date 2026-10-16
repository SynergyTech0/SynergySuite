import { route } from "@/lib/api";
import { orders } from "@/lib/sales";

export const GET = route(async (_ctx, req) => {
  const u = new URL(req.url).searchParams;
  return orders({ channel: u.get("channel") ?? "", status: u.get("status") ?? "", q: u.get("q") ?? "", from: u.get("from") ?? "", to: u.get("to") ?? "" });
});
