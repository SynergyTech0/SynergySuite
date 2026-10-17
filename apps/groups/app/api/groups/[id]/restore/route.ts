import { type Params, route } from "@/lib/api";
import { getGroup, restoreGroup } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

export const POST = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  await restoreGroup(me, id);
  void syncGroup(id);
  return getGroup(me, id);
});
