import { body, requireAdmin, route, type Params } from "@/lib/api";
import { addUpdate } from "@/lib/incidents";

export const POST = route(async (me, req, { params }: Params<"id">) => {
  requireAdmin(me);
  return { incident: await addUpdate((await params).id, await body(req), me.email) };
});
