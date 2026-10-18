import { body, route } from "@/lib/api";
import { rekey } from "@/lib/vault";

export const POST = route(async (me, req) => {
  await rekey(me, await body(req));
  return { ok: true };
});
