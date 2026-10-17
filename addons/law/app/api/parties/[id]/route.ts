import { type Params, route } from "@/lib/api";
import { removeParty } from "@/lib/law";

export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  await removeParty(me, (await params).id);
  return { ok: true };
});
