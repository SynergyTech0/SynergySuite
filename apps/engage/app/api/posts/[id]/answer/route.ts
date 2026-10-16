import { type Params, body, route } from "@/lib/api";
import { markAnswer } from "@/lib/engage";

export const POST = route(async (me, req, { params }: Params<"id">) => markAnswer(me, (await params).id, (await body(req)).commentId));
