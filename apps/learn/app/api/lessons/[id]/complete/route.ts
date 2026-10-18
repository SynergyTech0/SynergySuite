import { type Params, body, route } from "@/lib/api";
import { completeLesson } from "@/lib/learn";

export const POST = route(async (me, req, { params }: Params<"id">) => completeLesson(me, (await params).id, await body(req)));
