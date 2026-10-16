import { type Params, route } from "@/lib/api";
import { fileResponse } from "@/lib/serve";
import { filePath } from "@/lib/store";
import { mediaFor } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const GET = route(async (me, req, { params }: Params<"id">) => {
  const v = await mediaFor(me, (await params).id);
  return fileResponse(req, filePath(v.id, "poster"), { type: "image/jpeg" });
});
