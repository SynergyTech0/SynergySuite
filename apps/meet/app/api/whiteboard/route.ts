import { NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { getServerSession } from "@/lib/session";
import { WhiteboardError, meetingBoard, staffIn } from "@/lib/whiteboard";
import { livekitApiUrl } from "@/lib/livekit";

export const dynamic = "force-dynamic";

const LIVEKIT_URL = livekitApiUrl();

/**
 * Opens the meeting's whiteboard: { room } -> { url }. Only someone signed in to the suite who is
 * in the room right now (checked with LiveKit) gets it, and everyone signed in who is in the room
 * can edit it.
 */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Sign in to the suite to use the whiteboard" }, { status: 403 });
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return NextResponse.json({ error: "Meeting server not configured" }, { status: 503 });

  const { room } = (await req.json().catch(() => ({}))) as { room?: unknown };
  if (typeof room !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(room)) return NextResponse.json({ error: "Invalid room name" }, { status: 400 });

  let people: string[];
  try {
    people = staffIn(await new RoomServiceClient(LIVEKIT_URL, apiKey, apiSecret).listParticipants(room));
  } catch {
    return NextResponse.json({ error: "Couldn't check who is in the meeting" }, { status: 502 });
  }
  const me = session.user.email.toLowerCase();
  if (!people.includes(me)) return NextResponse.json({ error: "Join the meeting first" }, { status: 403 });

  try {
    const board = await meetingBoard(room, me, people);
    return NextResponse.json({ url: board.url });
  } catch (e) {
    const status = e instanceof WhiteboardError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message || "Couldn't open the whiteboard" }, { status });
  }
}
