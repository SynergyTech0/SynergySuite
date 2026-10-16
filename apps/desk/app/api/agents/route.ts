import { body, route } from "@/lib/api";
import { assertAgent, list, save } from "@/lib/agents";

/** The desk's agents, for agents to see; admins add or change one with POST { email, role, scope }. */
export const GET = route(async (me) => {
  assertAgent(me);
  return list();
});

export const POST = route(async (me, req) => save(me, await body(req)));
