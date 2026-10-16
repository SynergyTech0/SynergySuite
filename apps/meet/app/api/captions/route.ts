import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Transcription + live captions control (host only).
 *
 * One self-hosted worker (the SynergyMeet captions bot) does the transcribing. It is decoupled into
 * two independent things:
 *   - TRANSCRIPT: whenever the bot runs it transcribes locally, feeds the live transcript panel over
 *     the "transcript" data topic, and files the full transcript into the host's SynergyDrive at the
 *     end. This happens SILENTLY — no on-screen captions.
 *   - CAPTIONS: an extra "caption" overlay stream, broadcast only when captions are explicitly on.
 *
 * So a host can transcribe a whole meeting with nothing on screen, or additionally turn on the
 * visible captions. POST the desired state {room, transcript, captions}; this reconciles the bot
 * (start / change-mode / stop). Whisper only runs while transcription is on.
 */
const WORKER = process.env.CAPTIONS_WORKER_URL || "http://host.docker.internal:9081";

async function state(room: string) {
  const r = await fetch(`${WORKER}/health`, { cache: "no-store" });
  const d = await r.json();
  const transcribing = Array.isArray(d.active) && d.active.includes(room);
  const captions = Boolean(d.captions && d.captions[room]);
  return { transcribing, captions, available: true };
}

export async function GET(req: Request) {
  const room = new URL(req.url).searchParams.get("room");
  if (!room) return NextResponse.json({ error: "room required" }, { status: 400 });
  try {
    return NextResponse.json(await state(room));
  } catch {
    return NextResponse.json({ transcribing: false, captions: false, available: false });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Only signed-in hosts can control transcription" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const room = String(body.room || "").trim();
  if (!room) return NextResponse.json({ error: "room required" }, { status: 400 });

  const captions = Boolean(body.captions);
  const running = Boolean(body.transcript) || captions; // captions implies the bot must run

  const call = (path: string, payload: object) =>
    fetch(`${WORKER}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  try {
    const cur = await state(room).catch(() => ({ transcribing: false, captions: false }));
    if (running) {
      if (!cur.transcribing) {
        await call("/start", { room, hostEmail: session.user.email, captions });
      } else if (cur.captions !== captions) {
        await call("/mode", { room, captions });
      }
    } else if (cur.transcribing) {
      await call("/stop", { room });
    }
    return NextResponse.json({ transcribing: running, captions: running && captions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Captions worker unreachable" },
      { status: 502 },
    );
  }
}
