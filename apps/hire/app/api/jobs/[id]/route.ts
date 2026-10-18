import { type Params, body, route } from "@/lib/api";
import { deleteJob, jobFor, saveJob } from "@/lib/hire";

export const GET = route(async (me, _req, { params }: Params<"id">) => jobFor(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => saveJob(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteJob(me, (await params).id);
  return { ok: true };
});
