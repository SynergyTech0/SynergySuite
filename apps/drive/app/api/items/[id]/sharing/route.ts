import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => drive.sharing(me, (await params).id));

/** Share with someone, or change what they can do. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ email?: string; role?: string }>(req);
  await drive.share(me, id, b.email, b.role);
  return drive.sharing(me, id);
});

export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const email = new URL(req.url).searchParams.get("email");
  await drive.unshare(me, id, email);
  return email === me.email ? { ok: true } : drive.sharing(me, id);
});
