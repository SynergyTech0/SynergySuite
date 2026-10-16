import { body, route } from "@/lib/api";
import { discardTimer, getTimer, startTimer, stopTimer } from "@/lib/time";

export const GET = route(async (me) => ({ timer: await getTimer(me.email) }));

/** { projectId, taskId?, notes? } starts a timer; { stop: true, today } stops it into today's timesheet. */
export const POST = route(async (me, req) => {
  const b = await body<{ stop?: boolean; today?: string; projectId?: unknown; taskId?: unknown; notes?: unknown }>(req);
  if (b.stop) return { entry: await stopTimer(me.email, b.today), timer: null };
  return { timer: await startTimer(me.email, b) };
});

export const DELETE = route(async (me) => {
  await discardTimer(me.email);
});
