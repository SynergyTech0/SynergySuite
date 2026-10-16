import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

/** A view-only link anyone can open, optionally expiring after some days. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ expiresDays?: number }>(req);
  await drive.createLink(me, id, b.expiresDays);
  return drive.sharing(me, id);
});

export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await drive.deleteLink(me, id, new URL(req.url).searchParams.get("token") ?? "");
  return drive.sharing(me, id);
});
