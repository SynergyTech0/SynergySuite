import { body, requireAdmin, route, type Params } from "@/lib/api";
import { deleteWidget, updateWidget } from "@/lib/widgets";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  requireAdmin(me);
  return { widget: await updateWidget((await params).id, await body(req)) };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  requireAdmin(me);
  await deleteWidget((await params).id);
  return { ok: true };
});
