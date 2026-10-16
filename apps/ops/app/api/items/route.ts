import { body, route } from "@/lib/api";
import { createItem, listItems } from "@/lib/stock";

export const GET = route(async (_me, req) => {
  const sp = new URL(req.url).searchParams;
  return listItems({ q: sp.get("q") || undefined, source: sp.get("source") || undefined, low: sp.get("low") === "1", all: sp.get("all") === "1" });
});

export const POST = route(async (me, req) => createItem(await body(req), me.email));
