import { type Params, body, route } from "@/lib/api";
import { deleteEntry, updateEntry } from "@/lib/billing";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateEntry(me, (await params).id, await body(req));
  return { ok: true };
});
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteEntry(me, (await params).id);
  return { ok: true };
});
