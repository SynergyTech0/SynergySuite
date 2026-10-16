import { body, route } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { create, list } from "@/lib/kb";

export const GET = route(async (me) => list(me));

export const POST = route(async (me, req) => {
  assertAgent(me);
  return create(me.email, await body(req));
});
