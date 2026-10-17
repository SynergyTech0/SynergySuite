import { type Params, body, route } from "@/lib/api";
import { addMembers, getGroup, removeMember, setRole } from "@/lib/groups";
import { syncGroup } from "@/lib/sync";

/** Adds people or groups: { members: ["a@x.com", "group:<id>"], role?: "owner" | "member" }. */
export const POST = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ members?: unknown; role?: string }>(req);
  await addMembers(me, id, b.members, b.role === "owner" ? "owner" : "member");
  void syncGroup(id);
  return getGroup(me, id);
});

/** Makes someone an owner or a member: { member, role }. */
export const PATCH = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const b = await body<{ member?: string; role?: string }>(req);
  await setRole(me, id, String(b.member ?? ""), b.role === "owner" ? "owner" : "member");
  void syncGroup(id);
  return getGroup(me, id);
});

/** Removes ?member= (or leaves, when it is the signed-in person). */
export const DELETE = route(async (me, req, { params }: Params<"id">) => {
  const { id } = await params;
  const member = new URL(req.url).searchParams.get("member") ?? "";
  await removeMember(me, id, member);
  void syncGroup(id);
  return member.toLowerCase() === me.email ? { ok: true } : getGroup(me, id);
});
