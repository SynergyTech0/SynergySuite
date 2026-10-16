import { type Params, publicRoute } from "@/lib/api";
import { recordLinkView, sharedByToken } from "@/lib/videos";

export const POST = publicRoute(async (_req, { params }: Params<"token">) => {
  const v = await sharedByToken((await params).token);
  await recordLinkView(v.id);
  return { ok: true };
});
