import { type Params, body, route } from "@/lib/api";
import { deleteTask, updateTask } from "@/lib/projects";

/** Answers with the whole plan: a change can move other tasks (successors, summary dates). */
export const PATCH = route(async (me, req, { params }: Params<"id" | "taskId">) => {
  const { id, taskId } = await params;
  return updateTask(me.email, id, taskId, await body(req));
});

export const DELETE = route(async (me, _req, { params }: Params<"id" | "taskId">) => {
  const { id, taskId } = await params;
  await deleteTask(me.email, id, taskId);
});
