import { type Params, body, route } from "@/lib/api";
import { enroll, unenroll } from "@/lib/learn";

/** Enrol yourself (no emails), or assign the course to others (authors). */
export const POST = route(async (me, req, { params }: Params<"id">) => enroll(me, (await params).id, await body(req)));
/** Leave the course, or (authors) remove someone: { email }. */
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  await unenroll(me, (await params).id, await body(req).catch(() => ({})));
  return { ok: true };
});
