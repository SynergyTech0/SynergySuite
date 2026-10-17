import { NextRequest, NextResponse } from "next/server";
import { AiRequestError, AiUnavailableError } from "@synergy/ai";
import { identity } from "@/lib/identity";
import { configFor, MAX_PROMPT, MAX_TABLE, suggestFormula, suggestInsights, type FormulaContext } from "@/lib/sheet-ai";

export const dynamic = "force-dynamic";

const OFF = "AI is off: no model is set up for the suite (AI_MODEL, or OFFICE_AI_MODEL for the office apps).";

/** Whether the spreadsheet's AI helpers are available. */
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let config = null;
  try {
    config = await configFor();
  } catch {
    /* a misconfigured provider counts as off */
  }
  return NextResponse.json({ enabled: !!config, model: config?.model ?? null });
}

/**
 * { task: "formula", prompt, context } -> { formula, explanation }
 * { task: "insights", table } -> { insights: [{ title, text }] }
 */
export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const text = await req.text();
  if (text.length > MAX_TABLE + MAX_PROMPT + 8000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: { task?: string; prompt?: string; context?: FormulaContext; table?: string };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  try {
    if (body?.task === "formula") {
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) return NextResponse.json({ error: "Describe the formula you want." }, { status: 400 });
      return NextResponse.json(await suggestFormula(prompt, body.context && typeof body.context === "object" ? body.context : {}));
    }
    if (body?.task === "insights") {
      const table = String(body.table ?? "");
      if (!table.trim()) return NextResponse.json({ error: "No table to analyze." }, { status: 400 });
      return NextResponse.json(await suggestInsights(table));
    }
    return NextResponse.json({ error: "Unknown task" }, { status: 400 });
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: OFF }, { status: 503 });
    if (e instanceof AiRequestError) return NextResponse.json({ error: `The AI model could not answer: ${e.message.slice(0, 300)}` }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message || "The AI request failed." }, { status: 500 });
  }
}
