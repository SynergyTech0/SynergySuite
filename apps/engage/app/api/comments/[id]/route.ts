import { type Params, body, route } from "@/lib/api";
import { deleteComment, editComment } from "@/lib/engage";

export const PATCH = route(async (me, req, { params }: Params<"id">) => editComment(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteComment(me, (await params).id);
});
