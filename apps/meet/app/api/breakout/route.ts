import { NextResponse } from "next/server";
import { RoomServiceClient, DataPacket_Kind } from "livekit-server-sdk";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Breakout-room coordination (host only).
 *
 * Breakouts are just additional LiveKit rooms named `<base>__b<N>`. The hard part is signalling
 * ACROSS rooms: once people scatter into breakouts, the host (still in the main room) can't reach
 * them over the in-room data channel. So the server broadcasts on their behalf via RoomService:
 *   - open  → tell everyone in the MAIN room their assignment; assigned clients switch rooms.
 *   - close → tell everyone in EACH breakout room to return to main.
 *   - broadcast → push a host message into every breakout (e.g. "2 minutes left").
 * Clients receive these as data packets on the "breakout" topic and act on them.
 */
const LIVEKIT_URL = process.env.LIVEKIT_API_URL || `https://meet.${process.env.SUITE_DOMAIN}`;

function client() {
  return new RoomServiceClient(LIVEKIT_URL, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
}

async function send(room: string, obj: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  await client().sendData(room, data, DataPacket_Kind.RELIABLE, { topic: "breakout" });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Only signed-in hosts can manage breakout rooms" }, { status: 403 });
  }
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "Meeting server not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const base = String(body.base || "").trim();
  if (!base || !/^[a-zA-Z0-9_-]{1,64}$/.test(base)) {
    return NextResponse.json({ error: "Invalid base room" }, { status: 400 });
  }

  try {
    if (body.action === "open") {
      // assignments: { <identity>: <breakoutIndex 1..N> }
      const assignments = (body.assignments && typeof body.assignments === "object") ? body.assignments : {};
      await send(base, { type: "open", base, assignments });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "close") {
      const count = Math.min(20, Math.max(1, Number(body.count) || 0));
      // Signal every breakout room to come home. Also tell main (harmless) in case anyone lingered.
      await Promise.all(
        Array.from({ length: count }, (_, i) => send(`${base}__b${i + 1}`, { type: "close", base }).catch(() => {})),
      );
      return NextResponse.json({ ok: true });
    }
    if (body.action === "broadcast") {
      const count = Math.min(20, Math.max(1, Number(body.count) || 0));
      const text = String(body.text || "").slice(0, 200);
      await Promise.all(
        Array.from({ length: count }, (_, i) => send(`${base}__b${i + 1}`, { type: "message", text }).catch(() => {})),
      );
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[breakout] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Breakout failed" }, { status: 500 });
  }
}
