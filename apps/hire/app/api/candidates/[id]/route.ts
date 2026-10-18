import { type Params, body, route } from "@/lib/api";
import { deleteCandidate, getCandidate, updateCandidate } from "@/lib/hire";
import { hrRecordUrl } from "@/lib/hr";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const c = await getCandidate(me, (await params).id);
  return { ...c, hr_url: c.hr_person_id ? hrRecordUrl(c.hr_person_id) : null };
});
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateCandidate(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteCandidate(me, (await params).id);
  return { ok: true };
});
