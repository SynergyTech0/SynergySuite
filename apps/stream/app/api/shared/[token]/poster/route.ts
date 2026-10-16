import { type Params, publicRoute } from "@/lib/api";
import { fileResponse } from "@/lib/serve";
import { filePath } from "@/lib/store";
import { sharedByToken } from "@/lib/videos";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (req, { params }: Params<"token">) => {
  const v = await sharedByToken((await params).token);
  return fileResponse(req, filePath(v.id, "poster"), { type: "image/jpeg" });
});
