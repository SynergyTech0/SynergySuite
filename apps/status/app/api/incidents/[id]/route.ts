import { body, requireAdmin, route, type Params } from "@/lib/api";
import { deleteIncident, editIncident } from "@/lib/incidents";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  requireAdmin(me);
  return { incident: await editIncident((await params).id, await body(req)) };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  requireAdmin(me);
  await deleteIncident((await params).id);
  return { ok: true };
});
