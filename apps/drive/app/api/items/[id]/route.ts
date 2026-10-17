import { type Params, body, route } from "@/lib/api";
import * as drive from "@/lib/drive";

export const GET = route(async (me, _req, { params }: Params<"id">) => drive.details(me, (await params).id));

/** Rename, star and unstar, or set the sensitivity label (`labelId`, null to clear). */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ name?: string; starred?: boolean; labelId?: string | null }>(req);
  if (typeof b.starred === "boolean") await drive.setStar(me, id, b.starred);
  if (b.labelId !== undefined) {
    const item = await drive.setLabel(me, id, b.labelId);
    if (typeof b.name !== "string") return item;
  }
  if (typeof b.name === "string") return drive.rename(me, id, b.name);
  return { ok: true };
});
