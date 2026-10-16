import { type Params, body, route } from "@/lib/api";
import * as boards from "@/lib/boards";

export const GET = route(async (me, _req, { params }: Params<"id">) => ({ members: await boards.members(me, (await params).id) }));

/** Share with someone, or change what they can do: { email, role: "viewer" | "editor" }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ email?: string; role?: string }>(req);
  await boards.share(me, id, b.email, b.role);
  return { members: await boards.members(me, id) };
});

/** Remove someone (?email=), or leave the board yourself. */
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await boards.unshare(me, id, new URL(req.url).searchParams.get("email"));
  return { ok: true };
});
