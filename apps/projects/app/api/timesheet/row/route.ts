import { body, route } from "@/lib/api";
import { clearRow } from "@/lib/time";

/** Clears a project and task's open cells for the week: { week, projectId, taskId }. */
export const DELETE = route(async (me, req) => {
  const b = await body<{ week?: string; projectId?: string; taskId?: string | null }>(req);
  await clearRow(me.email, String(b.week ?? ""), String(b.projectId ?? ""), b.taskId || null);
});
