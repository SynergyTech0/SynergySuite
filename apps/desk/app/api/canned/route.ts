import { body, route } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { create, list } from "@/lib/canned";

// Canned replies are the agents' own library.
export const GET = route(async (me) => {
  assertAgent(me);
  return list();
});

export const POST = route(async (me, req) => {
  assertAgent(me);
  return create(me.email, await body(req));
});
