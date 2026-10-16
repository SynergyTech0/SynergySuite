import { tokenRoute } from "@/lib/api";
import { svcAssets } from "@/lib/assets";

export const dynamic = "force-dynamic";

/**
 * Assets for Field Service (Bearer OPS_API_TOKEN): `?tag=` for one, or `?q=` to search those in
 * service. [{ tag, name, category, location, make, model, serial, status, purchaseDate }]
 */
export const GET = tokenRoute(async (req) => {
  const p = new URL(req.url).searchParams;
  return svcAssets({ q: p.get("q") ?? "", tag: p.get("tag") ?? "" });
});
