import { type Params, body, route } from "@/lib/api";
import { deleteProject, getProject, updateProject } from "@/lib/projects";

export const GET = route(async (me, _req, { params }: Params<"id">) => getProject(me.email, (await params).id));

export const PATCH = route(async (me, req, { params }: Params<"id">) => updateProject(me.email, (await params).id, await body(req)));

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await deleteProject(me.email, (await params).id);
});
