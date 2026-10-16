import { type Params, body, vroute } from "@/lib/api";
import { setTaskDone } from "@/lib/hr";

export const POST = vroute(async (v, req, { params }: Params<"id">) => {
  const b = await body<{ done?: boolean }>(req);
  await setTaskDone(v, (await params).id, b.done !== false);
  return { ok: true };
});
