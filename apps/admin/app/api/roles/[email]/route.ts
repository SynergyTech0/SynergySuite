import { route, type Params } from "@/lib/api";
import { revoke } from "@/lib/roles";

export const DELETE = route("roles", async (me, _req, { params }: Params<"email">) => {
  await revoke(me, decodeURIComponent((await params).email));
  return { ok: true };
});
