import { type Params, body, route } from "@/lib/api";
import { decideRequest, getGroup } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

/** An owner lets someone in, or says no: { email, approve }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ email?: string; approve?: boolean }>(req);
  await decideRequest(me, id, String(b.email ?? ""), b.approve === true);
  if (b.approve === true) void syncGroup(id);
  return getGroup(me, id);
});
