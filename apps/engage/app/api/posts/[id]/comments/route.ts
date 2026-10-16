import { type Params, body, route } from "@/lib/api";
import { addComment } from "@/lib/engage";

export const POST = route(async (me, req, { params }: Params<"id">) => addComment(me, (await params).id, await body(req)));
