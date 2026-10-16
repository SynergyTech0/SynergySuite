import { type Params, body, route } from "@/lib/api";
import { addComment, listComments } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ comments: await listComments(me, (await params).id) }));

/** { body, at? }: a comment, optionally pinned to a moment (seconds). */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ body?: unknown; at?: unknown }>(req);
  return { comment: await addComment(me, (await params).id, b.body, b.at) };
});
