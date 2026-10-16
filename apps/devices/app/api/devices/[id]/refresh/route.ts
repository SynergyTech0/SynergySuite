import { route, type Params } from "@/lib/api";
import { refresh } from "@/lib/devices";

/** Asks the device for its inventory and posture now, instead of at the next scheduled run. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  await refresh(me, (await params).id);
  return { ok: true };
});
