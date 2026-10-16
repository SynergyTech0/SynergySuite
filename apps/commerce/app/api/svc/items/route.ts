import { svcRoute } from "@/lib/api";
import { svcItems } from "@/lib/svc";

export const dynamic = "force-dynamic";

/** Products with stock by location: `?q=` to search, or `?sku=A,B,C` for exactly those. */
export const GET = svcRoute(async (req) => {
  const p = new URL(req.url).searchParams;
  const skus = (p.get("sku") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return svcItems({ q: p.get("q") ?? "", skus });
});
