import { route } from "@/lib/http";
import { flowsAvailable, FlowsNotReady, listFlows } from "@/lib/services";

/** Flows the signed-in person can run from an app, for the studio's flow list. */
export const GET = route(async (_req, me) => {
  if (!flowsAvailable()) return { available: false, flows: [] };
  try {
    return { available: true, flows: await listFlows(me.email) };
  } catch (e) {
    if (e instanceof FlowsNotReady) return { available: false, flows: [] };
    return { available: true, flows: [], error: (e as Error).message };
  }
});
