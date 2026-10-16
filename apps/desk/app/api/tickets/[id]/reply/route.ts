import { body, idOf, route, type Params } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { get, reply } from "@/lib/tickets";

// { body, internal } - internal: true saves a staff-only note instead of emailing the requester.
export const POST = route(async (me, req, { params }: Params<"id">) => {
  assertAgent(me);
  const id = idOf((await params).id);
  await get(id, me); // only on tickets they can open
  return reply(id, me.email, await body<{ body?: unknown; internal?: unknown }>(req));
});
