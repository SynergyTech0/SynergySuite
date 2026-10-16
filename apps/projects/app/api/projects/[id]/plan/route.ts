import { type Params, body, route } from "@/lib/api";
import { addPlan } from "@/lib/projects";
import type { DraftPlan } from "@/lib/plan-ai";
import { UserError } from "@/lib/util";

/** Adds a whole plan (phases of tasks, one after another) from `start`. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const b = await body<{ start?: unknown; phases?: DraftPlan["phases"] }>(req);
  if (!Array.isArray(b.phases)) throw new UserError("phases must be a list");
  return addPlan(me.email, (await params).id, String(b.start ?? ""), b.phases);
});
