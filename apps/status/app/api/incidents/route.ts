import { body, requireAdmin, route } from "@/lib/api";
import { createIncident, listIncidents } from "@/lib/incidents";

export const GET = route(async () => ({ incidents: await listIncidents(100) }));

export const POST = route(async (me, req) => {
  requireAdmin(me);
  return { incident: await createIncident(await body(req), me.email) };
});
