import { NextRequest, NextResponse } from "next/server";
import { speechConfig, transcribe } from "@synergy/ai";
import { identity } from "@/lib/identity";
import { aiFailure } from "@/lib/slides/ai-server";

export const dynamic = "force-dynamic";

// Live subtitles where the browser has no speech recognition (Firefox): the
// slide show sends short pieces of the presenter's speech and gets their text
// back from the suite's speech model (SLIDES_AI_SPEECH_MODEL or AI_SPEECH_MODEL).
// GET: whether a speech model is configured. POST (audio body, ?lang=) -> { text }.
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = speechConfig({ prefix: "SLIDES_" });
  return NextResponse.json({ configured: !!cfg, model: cfg?.model || null });
}

const MAX_AUDIO = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = speechConfig({ prefix: "SLIDES_" });
  if (!cfg) return NextResponse.json({ error: "No speech model is configured for this suite. An administrator can set AI_SPEECH_MODEL on an OpenAI-compatible server." }, { status: 503 });
  const mime = (req.headers.get("content-type") || "audio/webm").split(";")[0];
  if (!/^audio\/[\w.+-]+$/.test(mime)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ text: "" });
  if (buf.length > MAX_AUDIO) return NextResponse.json({ error: "too large" }, { status: 413 });
  const lang = (req.nextUrl.searchParams.get("lang") || "").slice(0, 20);
  const prompt = (req.nextUrl.searchParams.get("prompt") || "").slice(0, 400);
  try {
    return NextResponse.json({ text: await transcribe(buf, { mime, language: lang, prompt, config: cfg }) });
  } catch (e) {
    const f = aiFailure(e);
    return NextResponse.json({ error: f.error }, { status: f.status });
  }
}
