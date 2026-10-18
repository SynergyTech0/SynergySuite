import { type Params, body, route } from "@/lib/api";
import { deleteLesson, updateLesson } from "@/lib/learn";

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateLesson(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteLesson(me, (await params).id);
  return { ok: true };
});
