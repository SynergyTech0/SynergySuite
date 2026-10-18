import { body, requireAdmin, route, type Params } from "@/lib/api";
import { deleteMonitor, getMonitor, recentChecks, updateMonitor } from "@/lib/monitors";

export const GET = route(async (_me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  return { monitor: await getMonitor(id), checks: await recentChecks(id, 100) };
});

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  requireAdmin(me);
  const { id } = await params;
  return { monitor: await updateMonitor(id, await body(req)) };
});

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  requireAdmin(me);
  await deleteMonitor((await params).id);
  return { ok: true };
});
