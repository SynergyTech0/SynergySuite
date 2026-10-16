import { NextResponse } from "next/server";
import { EgressClient, EncodedFileOutput, EncodedFileType } from "livekit-server-sdk";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Start / stop recording a meeting (host only).
 *
 * Recording is a "room composite" Egress: a headless Chrome joins the room, composites the grid and
 * encodes an MP4 to /opt/synergymeet/recordings on the host. Only a signed-in host (staff) may
 * control it — a guest link can never start or stop a recording.
 *
 * GET returns whether the room is currently being recorded (so the button reflects real state, not
 * just local optimism).
 */
const LIVEKIT_URL = process.env.LIVEKIT_API_URL || `https://meet.${process.env.SUITE_DOMAIN}`;

function client() {
  return new EgressClient(LIVEKIT_URL, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
}

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get("room");
  if (!room) return NextResponse.json({ error: "room required" }, { status: 400 });
  try {
    const list = await client().listEgress({ roomName: room, active: true });
    return NextResponse.json({ recording: list.length > 0, egressId: list[0]?.egressId ?? null });
  } catch {
    return NextResponse.json({ recording: false, egressId: null });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Only signed-in hosts can record" }, { status: 403 });
  }
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "Recording is not configured" }, { status: 503 });
  }

  const { room, action } = await req.json().catch(() => ({}));
  if (!room || !action) return NextResponse.json({ error: "room + action required" }, { status: 400 });

  const egress = client();
  try {
    if (action === "start") {
      // Refuse to double-record.
      const active = await egress.listEgress({ roomName: room, active: true });
      if (active.length > 0) {
        return NextResponse.json({ recording: true, egressId: active[0].egressId, already: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      // Encode the host's identity into the filename so the moat worker can attribute the
      // recording to the right person and file it into THEIR SynergyDrive tenant. '@' is
      // sanitised to '_at_' (the worker reverses it); '__' is our field separator.
      const host = session.user.email.replace(/@/g, "_at_").replace(/[^a-zA-Z0-9._-]/g, "");
      const safeRoom = room.replace(/[^a-zA-Z0-9._-]/g, "-");
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: `/out/${safeRoom}__${host}__${stamp}.mp4`,
      });
      const info = await egress.startRoomCompositeEgress(room, { file: output }, { layout: "grid" });
      return NextResponse.json({ recording: true, egressId: info.egressId });
    }

    if (action === "stop") {
      const active = await egress.listEgress({ roomName: room, active: true });
      for (const e of active) await egress.stopEgress(e.egressId);
      return NextResponse.json({ recording: false, stopped: active.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[record] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Recording failed" },
      { status: 500 },
    );
  }
}
