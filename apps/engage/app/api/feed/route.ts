import { route } from "@/lib/api";
import { feed } from "@/lib/engage";

export const GET = route(async (me, req) => {
  const u = new URL(req.url).searchParams;
  return feed(me.email, {
    view: u.get("view") ?? "home",
    community: u.get("community") ?? undefined,
    person: u.get("person") ?? undefined,
    topic: u.get("topic") ?? undefined,
    cursor: u.get("cursor"),
    limit: Number(u.get("limit")) || undefined,
  });
});
