import { body, route, type Params } from "@/lib/api";
import { cancelJob, getJob, rerunJob } from "@/lib/migrate";
import { UserError } from "@/lib/util";

export const GET = route("migrate", async (_me, _req, { params }: Params<"id">) => getJob((await params).id));
/** { action: "cancel" } stops it; { action: "rerun" } queues a delta run that copies only what changed. */
export const POST = route("migrate", async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const { action } = await body<{ action?: string }>(req);
  if (action === "cancel") return cancelJob(me, id);
  if (action === "rerun") return rerunJob(me, id);
  throw new UserError("Unknown action");
});
