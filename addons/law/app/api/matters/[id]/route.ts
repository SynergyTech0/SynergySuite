import { type Params, body, route } from "@/lib/api";
import { deleteMatter, getMatter, updateMatter } from "@/lib/law";

export const GET = route(async (me, _req, { params }: Params<"id">) => getMatter(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateMatter(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteMatter(me, (await params).id);
  return { ok: true };
});
