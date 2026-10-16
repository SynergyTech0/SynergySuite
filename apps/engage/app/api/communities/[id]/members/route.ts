import { type Params, body, route } from "@/lib/api";
import { addMember, members, removeMember } from "@/lib/engage";

export const GET = route(async (me, _req, { params }: Params<"id">) => members(me.email, (await params).id));
/** { email, role }: an admin adds someone or changes their role. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body(req);
  await addMember(me, (await params).id, b.email, b.role);
});
/** ?email=: an admin removes someone. */
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  await removeMember(me, (await params).id, new URL(req.url).searchParams.get("email"));
});
