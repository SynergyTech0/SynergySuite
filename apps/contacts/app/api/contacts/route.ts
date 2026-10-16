import { body, route } from "@/lib/api";
import { create, list } from "@/lib/contacts";
import type { ContactInput } from "@/lib/types";

export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  return list(me.email, { q: u.searchParams.get("q") ?? "", group: u.searchParams.get("group") ?? "", favorites: u.searchParams.get("favorites") === "1" });
});

export const POST = route(async (me, req) => {
  const b = await body<Partial<ContactInput> & { groups?: string[] }>(req);
  return create(me.email, b, Array.isArray(b.groups) ? b.groups.map(String) : []);
});
