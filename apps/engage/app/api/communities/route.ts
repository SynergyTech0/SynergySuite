import { body, route } from "@/lib/api";
import { communities, createCommunity } from "@/lib/engage";

export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return communities(me.email, { mine: u.get("mine") === "1", query: u.get("q") ?? "" });
});
export const POST = route(async (me, req) => createCommunity(me, await body(req)));
