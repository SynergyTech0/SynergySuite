import { body, route } from "@/lib/api";
import { products, saveProduct, type ProductFilter } from "@/lib/catalog";

export const GET = route(async (_ctx, req) => {
  const u = new URL(req.url).searchParams;
  return products({ q: u.get("q") ?? "", category: u.get("category") ?? "", status: (u.get("status") as ProductFilter["status"]) || "active" });
});
export const POST = route(async (ctx, req) => saveProduct(ctx, null, await body(req)));
