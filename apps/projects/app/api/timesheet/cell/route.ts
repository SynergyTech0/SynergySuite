import { body, route } from "@/lib/api";
import { setCell } from "@/lib/time";

/** Sets one cell: { projectId, taskId, day, hours, notes?, billable? }. Zero hours clears it. */
export const PUT = route(async (me, req) => ({ entry: await setCell(me.email, await body(req)) }));
