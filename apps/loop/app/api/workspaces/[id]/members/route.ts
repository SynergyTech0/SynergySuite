import { type Params, body, route } from "@/lib/api";
import { addWorkspaceMember, removeWorkspaceMember } from "@/lib/loop";

export const POST = route(async (me, req, { params }: Params<"id">) => addWorkspaceMember(me, (await params).id, await body(req)));
export const DELETE = route(async (me, req, { params }: Params<"id">) =>
  removeWorkspaceMember(me, (await params).id, new URL(req.url).searchParams.get("email")),
);
