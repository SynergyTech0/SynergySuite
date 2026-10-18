import { type Params, body, route } from "@/lib/api";
import { deleteCourse, getCourse, saveCourse } from "@/lib/learn";

export const GET = route(async (me, _req, { params }: Params<"id">) => getCourse(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => saveCourse(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteCourse(me, (await params).id);
  return { ok: true };
});
