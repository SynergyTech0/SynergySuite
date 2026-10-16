import { body, route } from "@/lib/http";
import { addComment, listComments } from "@/lib/comments";

type P = { id: string; rowId: string };

/** GET a record's comments, oldest first. */
export const GET = route<P>(async (_req, me, { id, rowId }) => ({ comments: await listComments(id, rowId, me.email) }));

/** POST `{ body }` adds a comment (editors and owners). */
export const POST = route<P>(async (req, me, { id, rowId }) => {
  const b = await body<{ body?: unknown }>(req);
  return Response.json({ comments: await addComment(id, rowId, me.email, b.body) }, { status: 201 });
});
