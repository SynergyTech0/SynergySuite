import { type Params, body, route } from "@/lib/api";
import { deleteDeadline, updateDeadline } from "@/lib/law";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateDeadline(me, (await params).id, await body(req));
  return { ok: true };
});
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteDeadline(me, (await params).id);
  return { ok: true };
});
