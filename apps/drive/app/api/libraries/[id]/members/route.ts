import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ members: await drive.members(me, (await params).id) }));

/** Add someone, or change their role. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ email?: string; role?: string }>(req);
  await drive.setMember(me, id, b.email, b.role);
  return { members: await drive.members(me, id) };
});

export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const email = new URL(req.url).searchParams.get("email");
  await drive.removeMember(me, id, email);
  return email === me.email ? { members: [] } : { members: await drive.members(me, id) };
});
