import { route, type Params } from "@/lib/api";
import { setStatus } from "@/lib/chat";

export const POST = route(async (me, _req, { params }: Params<"id">) => {
  await setStatus((await params).id, "closed", me.email);
  return { ok: true };
});
