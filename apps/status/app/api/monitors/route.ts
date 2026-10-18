import { body, requireAdmin, route } from "@/lib/api";
import { createMonitor, listMonitors } from "@/lib/monitors";

export const GET = route(async () => ({ monitors: await listMonitors() }));

export const POST = route(async (me, req) => {
  requireAdmin(me);
  return { monitor: await createMonitor(await body(req)) };
});
