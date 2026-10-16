import { body, route, type Params } from "@/lib/api";
import { removeLabel, updateLabel } from "@/lib/protection";

export const PATCH = route("protection", async (me, req, { params }: Params<"id">) => updateLabel(me, (await params).id, await body(req)));
export const DELETE = route("protection", async (me, _req, { params }: Params<"id">) => {
  await removeLabel(me, (await params).id);
  return { ok: true };
});
