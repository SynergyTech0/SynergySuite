import { body, route, type Params } from "@/lib/api";
import { deleteTask, getTask, updateTask, type TaskPatch } from "@/lib/todo";

export const GET = route(async (me, req, { params }: Params<"id">) => getTask(me.email, (await params).id, new URL(req.url).searchParams.get("today") ?? ""));

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateTask(me.email, (await params).id, await body<TaskPatch>(req)));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteTask(me.email, (await params).id);
});
