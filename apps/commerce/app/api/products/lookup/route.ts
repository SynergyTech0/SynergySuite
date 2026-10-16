import { route } from "@/lib/api";
import { lookup } from "@/lib/catalog";
import { UserError } from "@/lib/util";

/** A barcode scan or typed SKU at the register. */
export const GET = route(async (_ctx, req) => {
  const p = await lookup(new URL(req.url).searchParams.get("code") ?? "");
  if (!p) throw new UserError("No product with that code", 404);
  return p;
});
