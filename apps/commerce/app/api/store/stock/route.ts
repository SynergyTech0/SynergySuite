import { publicRoute } from "@/lib/api";
import { storeProducts } from "@/lib/store";

/** Current price and availability for what is in a shopper's cart. */
export const GET = publicRoute(async (req) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  return storeProducts({ ids });
});
