import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { aiDesignIdeas, aiDraftDeck, aiFailure, slidesAiConfig } from "@/lib/slides/ai-server";
import type { Slide } from "@/lib/slides/model";

export const dynamic = "force-dynamic";

// Slides AI tools. GET: whether a model is configured. POST { task: "design",
// slide, w, h } -> { ideas } (layouts for one slide); POST { task: "draft",
// prompt, slides } -> { draft } (a deck outline).
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = await slidesAiConfig();
  return NextResponse.json({ configured: !!cfg, model: cfg?.model || null });
}

const MAX_BODY = 512 * 1024;

export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const cfg = await slidesAiConfig();
  if (!cfg) return NextResponse.json({ error: "No AI model is configured for this suite. An administrator can set AI_MODEL with AI_API_KEY or AI_BASE_URL." }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    if (body.task === "design") {
      const s = body.slide as Slide;
      const w = Number(body.w), h = Number(body.h);
      if (!s || typeof s !== "object" || typeof s.title !== "string" || !Array.isArray(s.elements) || !(w > 0 && h > 0)) return NextResponse.json({ error: "bad request" }, { status: 400 });
      // pictures are described, never sent
      const slide: Slide = { ...s, bgImg: "", elements: s.elements.map((e) => (e.type === "image" ? { ...e, src: "" } : e)) };
      return NextResponse.json({ ideas: await aiDesignIdeas(slide, w, h, cfg) });
    }
    if (body.task === "draft") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return NextResponse.json({ error: "Describe the presentation you want." }, { status: 400 });
      return NextResponse.json({ draft: await aiDraftDeck(prompt, Number(body.slides) || 8, cfg) });
    }
    return NextResponse.json({ error: "unknown task" }, { status: 400 });
  } catch (e) {
    const f = aiFailure(e);
    return NextResponse.json({ error: f.error }, { status: f.status });
  }
}
