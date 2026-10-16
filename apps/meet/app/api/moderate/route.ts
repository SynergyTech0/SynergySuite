import { NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Host moderation — mute or remove a participant.
 *
 * This is server-authoritative on purpose: a client cannot mute or kick anyone by itself. Only a
 * STAFF member (someone with a real SynergyAuth session) may moderate; a guest link can never gain
 * host powers. The actual action goes through LiveKit's server API with the API secret, which never
 * reaches the browser.
 *
 * We reach LiveKit over its public /twirp path (nginx routes it to :7880) so this works whether the
 * app runs in the same container network as the media engine or not.
 */
const LIVEKIT_URL = process.env.LIVEKIT_API_URL || `https://meet.${process.env.SUITE_DOMAIN}`;

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    // No staff session -> not a host. Guests never moderate.
    return NextResponse.json({ error: "Only signed-in hosts can moderate" }, { status: 403 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "Meeting server not configured" }, { status: 503 });
  }

  const { room, identity, action, trackSid } = await req.json().catch(() => ({}));
  if (!room || !identity || !action) {
    return NextResponse.json({ error: "room, identity and action are required" }, { status: 400 });
  }

  const svc = new RoomServiceClient(LIVEKIT_URL, apiKey, apiSecret);

  try {
    if (action === "remove") {
      await svc.removeParticipant(room, identity);
    } else if (action === "mute") {
      // Mute every published track of the target (a host "mute" means silence them, not one track).
      const p = await svc.getParticipant(room, identity);
      for (const t of p.tracks ?? []) {
        if (!t.muted) await svc.mutePublishedTrack(room, identity, t.sid, true);
      }
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[moderate] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Moderation failed" },
      { status: 500 },
    );
  }
}
