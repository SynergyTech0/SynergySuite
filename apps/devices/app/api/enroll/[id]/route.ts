import { route, type Params } from "@/lib/api";
import { revokeSecret } from "@/lib/enroll";

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await revokeSecret(me.email, (await params).id, me.role === "admin");
  return { ok: true };
});
