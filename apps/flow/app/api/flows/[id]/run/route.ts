import { body, route } from "@/lib/api";
import { existingSession } from "@/lib/engine";
import { runFlow } from "@/lib/run";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Starts one of the person's app-startable flows: { inputs } in, { runId, status, outputs? } out. */
export const POST = route<Ctx>(async (me, req, { params }) => {
  const { id } = await params;
  const b = await body<{ inputs?: unknown }>(req);
  const inputs = b.inputs ?? {};
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new UserError("inputs must be an object of name: value");
  const s = await existingSession(me);
  if (!s) throw new UserError("No flow you can run from an app has that id", 404);
  return runFlow(s, id, inputs as Record<string, unknown>);
});
