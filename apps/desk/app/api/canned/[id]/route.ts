import { body, idOf, route, type Params } from "@/lib/api";
import { remove, update } from "@/lib/canned";

export const PATCH = route(async (_me, req, { params }: Params<"id">) => update(idOf((await params).id), await body(req)));

export const DELETE = route(async (_me, _req, { params }: Params<"id">) => {
  await remove(idOf((await params).id));
});
