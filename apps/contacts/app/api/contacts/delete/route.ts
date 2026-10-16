import { body, route } from "@/lib/api";
import { remove } from "@/lib/contacts";

export const POST = route(async (me, req) => {
  const b = await body<{ ids?: string[] }>(req);
  return { deleted: await remove(me.email, Array.isArray(b.ids) ? b.ids.map(String) : []) };
});
