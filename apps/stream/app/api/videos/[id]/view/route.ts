import { type Params, route } from "@/lib/api";
import { recordView } from "@/lib/videos";

export const POST = route(async (me, _req, { params }: Params<"id">) => {
  await recordView(me, (await params).id);
  return { ok: true };
});
