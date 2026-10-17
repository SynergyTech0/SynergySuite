import { route } from "@/lib/api";
import { requireDispatcher } from "@/lib/staff";
import { syncParts } from "@/lib/parts";

/** Sends any parts still waiting to Commerce now. */
export const POST = route(async (me) => {
  await requireDispatcher(me.email);
  return syncParts();
});
