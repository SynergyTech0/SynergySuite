import { body, route, type Params } from "@/lib/api";
import { deleteEntry, updateEntry } from "@/lib/vault";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateEntry(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteEntry(me, (await params).id);
  return { ok: true };
});
