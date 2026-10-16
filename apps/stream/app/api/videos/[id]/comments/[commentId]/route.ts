import { type Params, route } from "@/lib/api";
import { deleteComment } from "@/lib/videos";

export const DELETE = route(async (me, _req, { params }: Params<"id" | "commentId">) => {
  const { id, commentId } = await params;
  await deleteComment(me, id, commentId);
  return { ok: true };
});
