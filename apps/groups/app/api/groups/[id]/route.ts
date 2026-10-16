import { type Params, body, route } from "@/lib/api";
import { type GroupInput, deleteGroup, getGroup, updateGroup } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

export const GET = route(async (me, _req, { params }: Params<"id">) => getGroup(me, (await params).id));

export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  await updateGroup(me, id, await body<GroupInput>(req));
  void syncGroup(id);
  return getGroup(me, id);
});

/** Deletes the group: it leaves Chat, Drive, Calendar and Mail, and can be restored for 30 days. */
export const DELETE = route(async (me, _req, { params }: Params<"id">) => {
  const { id } = await params;
  await deleteGroup(me, id);
  void syncGroup(id);
  return { ok: true };
});
