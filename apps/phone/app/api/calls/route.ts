import { body, route } from "@/lib/api";
import { startCall } from "@/lib/calls";
import { historyFor } from "@/lib/history";

export const dynamic = "force-dynamic";

/** Your call history. ?missed=1 for missed calls only, ?before=<ISO> for older ones. */
export const GET = route(async (me, req) => {
  const u = new URL(req.url);
  return historyFor(me.email, { missedOnly: u.searchParams.get("missed") === "1", before: u.searchParams.get("before") });
});

/** Starts a call: { to } is a colleague's email, their number, or any phone number. */
export const POST = route(async (me, req) => {
  const { to } = await body<{ to?: string }>(req);
  const s = await startCall(me, to);
  return { callId: s.call.id, room: s.room, token: s.token, url: s.url, state: s.call.state, direction: s.call.direction, iceServers: s.iceServers };
});
