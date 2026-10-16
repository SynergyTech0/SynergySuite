import { body, route, type Params } from "@/lib/api";
import { getDevice, updateDevice } from "@/lib/devices";

export const GET = route(async (me, _req, { params }: Params<"id">) => getDevice(me, (await params).id));

/** { owner?, notes? } — admins. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  await updateDevice(me, (await params).id, await body(req));
  return { ok: true };
});
