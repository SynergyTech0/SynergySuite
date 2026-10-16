import { body, route, type Params } from "@/lib/api";
import { removeRule, updateRule } from "@/lib/protection";

export const PUT = route("protection", async (me, req, { params }: Params<"id">) => updateRule(me, (await params).id, await body(req)));
export const DELETE = route("protection", async (me, _req, { params }: Params<"id">) => {
  await removeRule(me, (await params).id);
  return { ok: true };
});
