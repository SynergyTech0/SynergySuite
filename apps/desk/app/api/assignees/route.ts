import { route } from "@/lib/api";
import { assertAgent } from "@/lib/agents";
import { assignees } from "@/lib/tickets";

export const GET = route(async (me) => {
  assertAgent(me);
  const known = await assignees();
  return known.includes(me.email) ? known : [me.email, ...known];
});
