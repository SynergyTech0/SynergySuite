import { type Params, publicRoute } from "@/lib/api";
import { sharedByToken } from "@/lib/videos";

export const dynamic = "force-dynamic";

/** A video through its "anyone with the link" link. No account needed. */
export const GET = publicRoute(async (_req, { params }: Params<"token">) => {
  const { source_ext: _ext, captions: _captions, ...video } = await sharedByToken((await params).token);
  return { video };
});
