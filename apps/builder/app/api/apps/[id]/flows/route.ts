import { body, HttpError, route } from "@/lib/http";
import { roleOn } from "@/lib/apps";
import { runFlow } from "@/lib/services";

/**
 * POST `{ flow, inputs }` runs a Synergy Flow flow for RunFlow() in an app, as the person using
 * the app: Flow decides whether they may run it.
 */
export const POST = route<{ id: string }>(async (req, me, { id }) => {
  await roleOn(id, me.email);
  const b = await body<{ flow?: unknown; inputs?: unknown }>(req);
  if (typeof b.flow !== "string" || !b.flow.trim() || b.flow.length > 200) throw new HttpError(400, "Name the flow to run");
  const inputs = b.inputs && typeof b.inputs === "object" && !Array.isArray(b.inputs) ? (b.inputs as Record<string, unknown>) : {};
  return runFlow(me.email, b.flow.trim(), inputs);
});
