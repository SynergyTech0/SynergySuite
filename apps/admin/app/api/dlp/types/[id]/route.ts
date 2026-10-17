import { route, type Params } from "@/lib/api";
import { removeType } from "@/lib/protection";

export const DELETE = route("protection", async (me, _req, { params }: Params<"id">) => {
  await removeType(me, (await params).id);
  return { ok: true };
});
