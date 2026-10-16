import { type Params, publicRoute } from "@/lib/api";
import * as drive from "@/lib/drive";
import { fileResponse, zipResponse } from "@/lib/serve";

export const GET = publicRoute(async (req, { params }: Params<"token">) => {
  const { token } = await params;
  const url = new URL(req.url);
  const item = url.searchParams.get("item");
  const view = await drive.linkView(token, item);
  if (view.item.kind === "folder") {
    const row = await drive.linkFolder(token, item);
    return zipResponse(row.name, await drive.tree(row.id), drive.limits().zipMax);
  }
  const { row, sha, size } = await drive.linkContent(token, item);
  return fileResponse(req, { name: row.name, mime: row.mime, sha, size }, url.searchParams.get("inline") === "1");
});
