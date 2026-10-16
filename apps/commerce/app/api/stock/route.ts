import { route } from "@/lib/api";
import { stockSheet } from "@/lib/stock";

export const GET = route(async (_ctx, req) => {
  const u = new URL(req.url).searchParams;
  return stockSheet({ q: u.get("q") ?? "", locationId: u.get("location") ?? "" });
});
