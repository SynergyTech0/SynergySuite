import { type Params, body, route } from "@/lib/api";
import { deleteVoicemail, markHeard } from "@/lib/history";

export const dynamic = "force-dynamic";

/** { heard: true | false } */
export const PATCH = route(async (me, req, ctx: Params<"id">) => {
  const { id } = await ctx.params;
  const { heard } = await body<{ heard?: boolean }>(req);
  return markHeard(me.email, id, heard !== false);
});

export const DELETE = route(async (me, _req, ctx: Params<"id">) => deleteVoicemail(me.email, (await ctx.params).id));
