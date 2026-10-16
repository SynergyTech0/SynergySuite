import { body, idOf, route, type Params } from "@/lib/api";
import { assertAgent, assertIsAgent } from "@/lib/agents";
import { get, update, type TicketPatch } from "@/lib/tickets";

export const GET = route(async (me, _req, { params }: Params<"id">) => get(idOf((await params).id), me));

/** Status, priority and assignee: agents only, on tickets they can open, assigned to agents. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  assertAgent(me);
  const id = idOf((await params).id);
  await get(id, me);
  const patch = await body<TicketPatch>(req);
  if (patch.assignee) await assertIsAgent(String(patch.assignee));
  await update(id, patch);
  return get(id, me);
});
