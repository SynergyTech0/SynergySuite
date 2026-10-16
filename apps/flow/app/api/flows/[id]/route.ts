import { body, route } from "@/lib/api";
import { deleteFlow, personSession, setFlowEnabled } from "@/lib/engine";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a flow on or off. */
export const PATCH = route<Ctx>(async (me, req, { params }) => {
  const { id } = await params;
  const b = await body<{ enabled?: unknown }>(req);
  if (typeof b.enabled !== "boolean") throw new UserError("Say whether the flow is on (enabled: true or false)");
  const s = await personSession(me);
  return { flow: await setFlowEnabled(s, id, b.enabled) };
});

export const DELETE = route<Ctx>(async (me, _req, { params }) => {
  const { id } = await params;
  const s = await personSession(me);
  await deleteFlow(s, id);
  return { ok: true };
});
