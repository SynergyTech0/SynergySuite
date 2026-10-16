import { type Params, body, route } from "@/lib/api";
import { addChannel, getGroup } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

/** A new channel in a team: { name, topic? }. It appears in Chat for every member. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ name?: string; topic?: string }>(req);
  await addChannel(me, id, b.name, b.topic);
  await syncGroup(id);
  return getGroup(me, id);
});
