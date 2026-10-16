import { type CallRow, callInRoom, finish, inbound, partyLeft } from "./calls";
import { q } from "./db";
import { AGENT_IDENTITY } from "./livekit";
import { INBOUND_ROOM_PREFIX } from "./trunks";

/** The parts of a LiveKit webhook event Phone reads. */
export type LkEvent = {
  event: string;
  room?: { name: string };
  participant?: { identity: string; name?: string; kind?: number; attributes?: Record<string, string> };
};

/** LiveKit's ParticipantInfo.Kind for a SIP participant. */
const SIP_KIND = 3;

/**
 * What LiveKit tells us about rooms (sent to POST /api/livekit/webhook). Meet's rooms come
 * through here too; anything that isn't a Phone call is ignored.
 */
export async function handleWebhook(e: LkEvent): Promise<void> {
  const room = e.room?.name;
  if (!room) return;
  const p = e.participant;
  if (e.event === "participant_joined" && p) {
    if (p.identity === AGENT_IDENTITY) return;
    if (room.startsWith(INBOUND_ROOM_PREFIX) && p.kind === SIP_KIND) {
      await inbound(room, p.identity, p.attributes ?? {}, p.name ?? "");
      return;
    }
    const c = await callInRoom(room);
    if (c) await q("UPDATE parties SET joined_at = COALESCE(joined_at, now()) WHERE call_id = $1 AND identity = $2", [c.id, p.identity]);
    return;
  }
  if (e.event === "participant_left" && p) {
    const calls = await q<CallRow>(
      `SELECT c.* FROM calls c JOIN parties pa ON pa.call_id = c.id
       WHERE c.room = $1 AND pa.identity = $2 AND c.state NOT IN ('ended', 'missed', 'declined', 'failed')`,
      [room, p.identity],
    );
    for (const c of calls) await partyLeft(c, p.identity);
    return;
  }
  if (e.event === "room_finished") {
    const open = await q<CallRow>("SELECT * FROM calls WHERE room = $1 AND state NOT IN ('ended', 'missed', 'declined', 'failed')", [room]);
    for (const c of open) {
      // The voicemail worker closes its own calls once the message is saved.
      if (c.state === "voicemail") continue;
      await finish(c, "ended");
    }
  }
}
