import { type Params, body, route } from "@/lib/api";
import { person, updateProfile } from "@/lib/engage";
import { UserError } from "@/lib/util";

export const GET = route(async (me, _req, { params }: Params<"email">) => person(me.email, decodeURIComponent((await params).email)));
/** People edit their own title, department and about. */
export const PATCH = route(async (me, req, { params }: Params<"email">) => {
  if (decodeURIComponent((await params).email).toLowerCase() !== me.email) throw new UserError("You can only change your own profile", 403);
  await updateProfile(me, await body(req));
  return person(me.email, me.email);
});
