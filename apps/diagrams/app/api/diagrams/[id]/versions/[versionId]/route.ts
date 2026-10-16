import { type Params, route } from "@/lib/api";
import { restore, versionXml } from "@/lib/diagrams";

/** An earlier version's drawing, to preview. */
export const GET = route(async (me, _req, { params }: Params<"id" | "versionId">) => {
  const { id, versionId } = await params;
  return versionXml(me.email, id, versionId);
});

/** Makes that version the current one. */
export const POST = route(async (me, _req, { params }: Params<"id" | "versionId">) => {
  const { id, versionId } = await params;
  return restore(me.email, id, versionId);
});
