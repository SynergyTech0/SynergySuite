import { route, type Params } from "@/lib/api";
import { remove } from "@/lib/retention";

export const DELETE = route("retention.edit", async (me, _req, { params }: Params<"id">) => {
  await remove(me, (await params).id);
  return { ok: true };
});
