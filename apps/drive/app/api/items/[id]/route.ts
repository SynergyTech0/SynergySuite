import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => drive.details(me, (await params).id));

/** Rename, or star and unstar. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ name?: string; starred?: boolean }>(req);
  if (typeof b.starred === "boolean") await drive.setStar(me, id, b.starred);
  if (typeof b.name === "string") return drive.rename(me, id, b.name);
  return { ok: true };
});
