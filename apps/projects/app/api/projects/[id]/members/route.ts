import { type Params, body, route } from "@/lib/api";
import { removeMember, setMember } from "@/lib/projects";

/** Adds someone to the team, or changes their role, rates or weekly hours. */
export const POST = route(async (me, req, { params }: Params<"id">) => setMember(me.email, (await params).id, await body(req)));

export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  await removeMember(me.email, (await params).id, new URL(req.url).searchParams.get("email") ?? "");
});
