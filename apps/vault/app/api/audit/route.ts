import { body, route } from "@/lib/api";
import { auditLog, report } from "@/lib/vault";

export const GET = route(async () => auditLog());
export const POST = route(async (me, req) => {
  await report(me, await body(req));
  return { ok: true };
});
