import { body, route } from "@/lib/api";
import { initVault } from "@/lib/vault";

export const POST = route(async (me, req) => {
  await initVault(me, await body(req));
  return { ok: true };
});
