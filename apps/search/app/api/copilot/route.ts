import { NextResponse } from "next/server";
import { AiRequestError, AiUnavailableError } from "@synergy/ai";
import { body, route } from "@/lib/api";
import { AI_OFF_MESSAGE, begin, searchAiConfig } from "@/lib/ask";
import { readCopilot, respond } from "@/lib/copilot/copilot";

export const dynamic = "force-dynamic";

/**
 * POST { message, history?, app?, context?, tz? } from the Copilot panel. Answers, summarizes the
 * open item, or proposes actions. Proposing never changes anything: see /api/copilot/confirm.
 */
export const POST = route(async (me, req) => {
  if (!searchAiConfig()) return NextResponse.json({ error: AI_OFF_MESSAGE, aiOff: true }, { status: 503 });
  const input = readCopilot(await body(req));
  const done = begin(me.email);
  try {
    return await respond(me, input);
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: AI_OFF_MESSAGE, aiOff: true }, { status: 503 });
    if (e instanceof AiRequestError) {
      console.error("[search] copilot:", e.message);
      return NextResponse.json({ error: "The AI model didn't answer. Try again in a moment." }, { status: 502 });
    }
    throw e;
  } finally {
    done();
  }
});
