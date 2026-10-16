import { type Params, publicRoute } from "@/lib/api";
import { vttResponse } from "@/lib/serve";
import { sharedByToken } from "@/lib/videos";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async (_req, { params }: Params<"token">) => {
  const v = await sharedByToken((await params).token);
  if (!v.captions) throw new UserError("This video has no captions", 404);
  return vttResponse(v.captions);
});
