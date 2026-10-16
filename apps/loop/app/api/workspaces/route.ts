import { body, route } from "@/lib/api";
import { createWorkspace, listWorkspaces } from "@/lib/loop";

export const GET = route(async (me) => ({ workspaces: await listWorkspaces(me) }));
export const POST = route(async (me, req) => createWorkspace(me, await body(req)));
