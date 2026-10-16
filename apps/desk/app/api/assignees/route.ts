import { route } from "@/lib/api";
import { assignees } from "@/lib/tickets";

export const GET = route(async (me) => {
  const known = await assignees();
  return known.includes(me.email) ? known : [me.email, ...known];
});
