import { requireAdmin, route, type Params } from "@/lib/api";
import { getMonitor, runCheck } from "@/lib/monitors";

/** Checks a monitor right away instead of waiting for its next turn. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  requireAdmin(me);
  return { check: await runCheck(await getMonitor((await params).id)) };
});
