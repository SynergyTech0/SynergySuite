import { body, route, type Params } from "@/lib/api";
import { deleteList, updateList } from "@/lib/todo";

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateList(me.email, (await params).id, await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteList(me.email, (await params).id);
});
