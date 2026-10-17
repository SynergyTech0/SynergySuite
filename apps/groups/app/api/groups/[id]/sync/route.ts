import { type Params, route } from "@/lib/api";
import { getGroup, requireOwner } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

/** Owners: set the group up again in every app now, instead of waiting for the next sweep. */
export const POST = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  await requireOwner(me.email, id);
  await syncGroup(id);
  return getGroup(me, id);
});
