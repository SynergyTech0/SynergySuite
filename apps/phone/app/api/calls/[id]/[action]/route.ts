import { type Params, body, route } from "@/lib/api";
import { addToCall, answer, decline, hangup, openInMeet } from "@/lib/calls";
import { hideCall } from "@/lib/history";
import { UserError } from "@/lib/util";

export const dynamic = "force-dynamic";

/**
 * POST /api/calls/<id>/answer | decline | hangup | add {to} | transfer {to} | meet | hide
 */
export const POST = route(async (me, req, ctx: Params<"id" | "action">) => {
  const { id, action } = await ctx.params;
  switch (action) {
    case "answer": {
      const s = await answer(me, id);
      return { callId: s.call.id, room: s.room, token: s.token, url: s.url, state: s.call.state, direction: s.call.direction, iceServers: s.iceServers };
    }
    case "decline":
      return decline(me, id);
    case "hangup":
      return hangup(me, id);
    case "add":
    case "transfer": {
      const { to } = await body<{ to?: string }>(req);
      return addToCall(me, id, to, action === "transfer");
    }
    case "meet":
      return openInMeet(me, id);
    case "hide":
      return hideCall(me.email, id);
    default:
      throw new UserError("Not found", 404);
  }
});
