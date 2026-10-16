import { body, route } from "@/lib/api";
import { createAsset, listAssets } from "@/lib/assets";

export const GET = route(async (me, req) => {
  const sp = new URL(req.url).searchParams;
  return listAssets({ q: sp.get("q") || undefined, status: sp.get("status") || undefined, mine: sp.get("mine") === "1" ? me.email : undefined });
});

export const POST = route(async (me, req) => createAsset(await body(req), me.email));
