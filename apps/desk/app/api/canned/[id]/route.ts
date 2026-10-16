import { body, idOf, route, type Params } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { remove, update } from "@/lib/canned";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  assertAgent(me);
  return update(idOf((await params).id), await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  assertAgent(me);
  await remove(idOf((await params).id));
});
