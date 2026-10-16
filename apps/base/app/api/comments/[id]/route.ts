import { route } from "@/lib/http";
import { deleteComment } from "@/lib/comments";

/** DELETE a comment (its author, or an owner of the database). */
export const DELETE = route<{ id: string }>(async (_req, me, { id }) => {
  await deleteComment(id, me.email);
  return new Response(null, { status: 204 });
});
