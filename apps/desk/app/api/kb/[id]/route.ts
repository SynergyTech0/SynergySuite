import { body, idOf, route, type Params } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { get, remove, update } from "@/lib/kb";

export const GET = route(async (me, _req, { params }: Params<"id">) => get(idOf((await params).id), me));

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  assertAgent(me);
  return update(me.email, idOf((await params).id), await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  assertAgent(me);
  await remove(idOf((await params).id));
});
