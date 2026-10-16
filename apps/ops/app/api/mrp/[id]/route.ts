import { body, idOf, route, type Params } from "@/lib/api";
import { dismissPlanned, firmPlanned } from "@/lib/mfg";
import { oneOf } from "@/lib/util";

/** { action: firm | dismiss } on one suggestion. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const id = idOf((await params).id);
  const action = oneOf((await body(req)).action, ["firm", "dismiss"] as const, "action");
  if (action === "firm") return firmPlanned(id, me.email);
  await dismissPlanned(id);
  return { ok: true };
});
