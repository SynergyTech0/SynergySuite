import { type Params, body, route } from "@/lib/api";
import { deleteWorkspace, getWorkspace, updateWorkspace } from "@/lib/loop";

export const GET = route(async (me, _req, { params }: Params<"id">) => getWorkspace(me, (await params).id));
export const PATCH = route(async (me, req, { params }: Params<"id">) => updateWorkspace(me, (await params).id, await body(req)));
export const DELETE = route(async (me, _req, { params }: Params<"id">) => deleteWorkspace(me, (await params).id));
