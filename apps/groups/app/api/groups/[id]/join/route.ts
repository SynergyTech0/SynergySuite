import { type Params, body, route } from "@/lib/api";
import { join } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

/** Joins a public group, or asks a private group's owners: { message? }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ message?: string }>(req).catch(() => ({ message: "" }));
  const out = await join(me, id, b.message ?? "");
  if (out.joined) void syncGroup(id);
  return out;
});
