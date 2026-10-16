import { type Params, body, route } from "@/lib/api";
import { createTask, listTasks } from "@/lib/projects";

export const GET = route(async (me, _req, { params }: Params<"id">) => listTasks(me.email, (await params).id));

export const POST = route(async (me, req, { params }: Params<"id">) => createTask(me.email, (await params).id, await body(req)));
