import { getAlert, updateAlert } from "@/lib/alerts";
import { adminRoute, body, route, type Params } from "@/lib/api";
import { DETECTIONS } from "@/lib/detections";
import { UserError } from "@/lib/util";

export const GET = route(async (me, _req, { params }: Params<"id">) => {
  const a = await getAlert((await params).id);
  if (me.role !== "admin" && a.owner !== me.email) throw new UserError("No such alert", 404);
  return { ...a, info: DETECTIONS.find((d) => d.id === a.detection) ?? null };
});

/** { status?, assignedTo?, note? } — admins triage alerts. */
export const PATCH = adminRoute(async (me, req, { params }: Params<"id">) => {
  await updateAlert(me.email, (await params).id, await body(req));
  return { ok: true };
});
