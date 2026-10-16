import { type Params, publicRoute } from "@/lib/api";
import { fileResponse } from "@/lib/serve";
import { filePath } from "@/lib/store";
import { sharedByToken } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (req, { params }: Params<"token">) => {
  const v = await sharedByToken((await params).token);
  if (v.status !== "ready") return Response.json({ error: "This video is still processing" }, { status: 409 });
  return fileResponse(req, filePath(v.id, "web"), { type: "video/mp4" });
});
export const HEAD = GET;
