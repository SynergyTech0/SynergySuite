import { type Params, body, route } from "@/lib/api";
import { addLesson } from "@/lib/learn";

export const POST = route(async (me, req, { params }: Params<"id">) => addLesson(me, (await params).id, await body(req)));
