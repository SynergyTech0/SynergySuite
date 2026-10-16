import { body, route } from "@/lib/api";
import { createPost, type NewPost } from "@/lib/engage";

export const POST = route(async (me, req) => createPost(me, await body<NewPost>(req)));
