import { type Params, route } from "@/lib/api";
import * as drive from "@/lib/drive";
import { fileResponse, zipResponse } from "@/lib/serve";

/** Download (or ?inline=1 to show in the browser). A folder downloads as a zip; ?v= picks a version. */
export const GET = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const url = new URL(req.url);
  const details = await drive.details(me, id);
  if (details.kind === "folder") {
    const row = await drive.folderForZip(me, id);
    return zipResponse(row.name, await drive.tree(row.id), drive.limits().zipMax);
  }
  const v = url.searchParams.get("v");
  const { row, sha, size } = await drive.content(me, id, v ? Number(v) : undefined);
  return fileResponse(req, { name: row.name, mime: row.mime, sha, size }, url.searchParams.get("inline") === "1");
});
