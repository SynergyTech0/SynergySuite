import { body, route } from "@/lib/api";
import { createMatter, listMatters } from "@/lib/law";

export const GET = route(async (me, req) => {
  const s = new URL(req.url).searchParams;
  return listMatters(me, { view: s.get("view") ?? undefined, q: s.get("q")?.trim() || undefined, status: s.get("status") ?? undefined, client: s.get("client") ?? undefined });
});
export const POST = route(async (me, req) => createMatter(me, await body(req)));
