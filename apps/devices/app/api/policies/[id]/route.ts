import { adminRoute, body, type Params } from "@/lib/api";
import { deletePolicy, updatePolicy } from "@/lib/devices";

export const PATCH = adminRoute(async (me, req, { params }: Params<"id">) => {
  await updatePolicy(me, (await params).id, await body(req));
  return { ok: true };
});

export const DELETE = adminRoute(async (me, _req, { params }: Params<"id">) => {
  await deletePolicy(me, (await params).id);
  return { ok: true };
});
