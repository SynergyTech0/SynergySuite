import { body, route, type Params } from "@/lib/api";
import { person, setActive } from "@/lib/directory";
import { UserError } from "@/lib/util";

export const GET = route("people", async (_me, _req, { params }: Params<"id">) => person((await params).id));
export const PATCH = route("people", async (me, req, { params }: Params<"id">) => {
  const v = await body<{ active?: unknown }>(req);
  if (typeof v.active !== "boolean") throw new UserError("Say whether the person may sign in");
  return setActive(me, (await params).id, v.active);
});
