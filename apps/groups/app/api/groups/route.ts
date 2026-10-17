import { body, route } from "@/lib/api";
import { type GroupInput, type View, createGroup, getGroup, listGroups } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

const VIEWS: View[] = ["mine", "discover", "deleted"];

/** My groups, public groups to join (?view=discover), or deleted ones I can restore (?view=deleted). */
export const GET = route(async (me, req) => {
  const v = new URL(req.url).searchParams.get("view") as View;
  return { groups: await listGroups(me, VIEWS.includes(v) ? v : "mine") };
});

export const POST = route(async (me, req) => {
  const id = await createGroup(me, await body<GroupInput>(req));
  // Setting up the team's chat, files, calendar and mailbox happens in the background; the
  // page shows each part as it arrives.
  void syncGroup(id);
  return getGroup(me, id);
});
