import { body, idOf, route, type Params } from "@/lib/api";
import { get, remove, update } from "@/lib/kb";

export const GET = route(async (_me, _req, { params }: Params<"id">) => get(idOf((await params).id)));

export const PATCH = route(async (me, req, { params }: Params<"id">) => update(me.email, idOf((await params).id), await body(req)));

export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await remove(idOf((await params).id));
});
