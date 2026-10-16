import { type Params, body, route } from "@/lib/api";
import { deletePost, getPost, updatePost } from "@/lib/engage";

export const GET = route(async (me, _req, { params }: Params<"id">) => getPost(me.email, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updatePost(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deletePost(me, (await params).id);
});
