import { type Me, type Params, route } from "@/lib/api";
import { fileResponse } from "@/lib/serve";
import { filePath } from "@/lib/store";
import { mediaFor } from "@/lib/videos";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ogv: "video/ogg" };

/**
 * The video's bytes, with range requests for seeking: the playable copy, or with ?original the file
 * as it was uploaded (?download to save it).
 */
async function serve(me: Me, req: Request, id: string) {
  const v = await mediaFor(me, id);
  const url = new URL(req.url);
  if (url.searchParams.has("original") || url.searchParams.has("download")) {
    return fileResponse(req, filePath(v.id, "source", v.source_ext), {
      type: TYPES[v.source_ext] ?? "application/octet-stream",
      name: v.source_name,
      download: url.searchParams.has("download"),
    });
  }
  if (v.status !== "ready") return Response.json({ error: "This video is still processing" }, { status: 409 });
  return fileResponse(req, filePath(v.id, "web"), { type: "video/mp4" });
}

export const GET = route(async (me, req, { params }: Params<"id">) => serve(me, req, (await params).id));
export const HEAD = GET;
