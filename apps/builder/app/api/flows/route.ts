import { route } from "@/lib/http";
import { flowsAvailable, listFlows } from "@/lib/services";

/** Flows the signed-in person can run from an app, for the studio's flow list. */
export const GET = route(async (_req, me) => {
  if (!flowsAvailable()) return { available: false, flows: [] };
  try {
    return { available: true, flows: await listFlows(me.email) };
  } catch (e) {
    return { available: true, flows: [], error: (e as Error).message };
  }
});
