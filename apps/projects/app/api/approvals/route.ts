import { body, route } from "@/lib/api";
import { decide, pendingApprovals, reopen } from "@/lib/time";

export const GET = route(async (me) => pendingApprovals(me.email));

/** { time: [ids], expenses: [ids], approve: true } or { …, approve: false, reason }; { reopen: true, … } reopens approved items. */
export const POST = route(async (me, req) => {
  const b = await body<{ reopen?: boolean; time?: unknown; expenses?: unknown; approve?: unknown; reason?: unknown }>(req);
  if (b.reopen) return { reopened: await reopen(me.email, b) };
  return decide(me.email, b);
});
