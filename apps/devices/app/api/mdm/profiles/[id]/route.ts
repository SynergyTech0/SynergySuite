import { adminRoute, body, type Params } from "@/lib/api";
import { deleteProfile, updateProfile } from "@/lib/mdm/catalog";

export const PATCH = adminRoute(async (me, req, { params }: Params<"id">) => {
  await updateProfile(me, (await params).id, await body(req));
  return { ok: true };
});

/** Removes the profile from every device that has it. */
export const DELETE = adminRoute(async (me, _req, { params }: Params<"id">) => {
  await deleteProfile(me, (await params).id);
  return { ok: true };
});
