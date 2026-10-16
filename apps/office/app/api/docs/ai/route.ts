import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { AI_TASKS, aiDocsTask, docsAiConfig, docsAiFailure } from "@/lib/docs/ai-server";
import { AI_MAX_TEXT, TONES, type AiTask, type Tone } from "@/lib/docs/ai";

export const dynamic = "force-dynamic";

// Docs AI tools. GET: whether a model is configured. POST { task: "rewrite" |
// "summarize" | "grammar", text, tone? } or { task: "draft", prompt, context? }
// -> { markdown }.
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = docsAiConfig();
  return NextResponse.json({ configured: !!cfg, model: cfg?.model || null });
}

const MAX_BODY = 256 * 1024;

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = docsAiConfig();
  if (!cfg) return NextResponse.json({ error: "No AI model is configured for this suite. An administrator can set AI_MODEL with AI_API_KEY or AI_BASE_URL." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const task = body.task as AiTask;
  if (!AI_TASKS.includes(task)) return NextResponse.json({ error: "unknown task" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const text = str(body.text).trim();
  const prompt = str(body.prompt).trim();
  if (task === "draft" ? !prompt : !text) return NextResponse.json({ error: task === "draft" ? "Describe what to write." : "Select some text first." }, { status: 400 });
  if (text.length > AI_MAX_TEXT) return NextResponse.json({ error: `The text is too long (over ${AI_MAX_TEXT} characters). Select a shorter part.` }, { status: 413 });
  const tone = TONES.some((t) => t.id === body.tone) ? (body.tone as Tone) : undefined;
  try {
    return NextResponse.json({ markdown: await aiDocsTask(task, { text, tone, prompt, context: str(body.context) }, cfg) });
  } catch (e) {
    const f = docsAiFailure(e);
    return NextResponse.json({ error: f.error }, { status: f.status });
  }
}
