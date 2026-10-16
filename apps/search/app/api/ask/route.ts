import { NextResponse } from "next/server";
import { AiRequestError, AiUnavailableError } from "@synergy/ai";
import { body, route } from "@/lib/api";
import { AI_OFF_MESSAGE, answer, begin, readAsk, searchAiConfig } from "@/lib/ask";

export const dynamic = "force-dynamic";

/** POST { question, history? } → { answer, sources } from the signed-in person's own content. */
export const POST = route(async (me, req) => {
  if (!searchAiConfig()) return NextResponse.json({ error: AI_OFF_MESSAGE, aiOff: true }, { status: 503 });
  const input = readAsk(await body(req));
  const done = begin(me.email);
  try {
    return await answer(me, input);
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: AI_OFF_MESSAGE, aiOff: true }, { status: 503 });
    if (e instanceof AiRequestError) {
      console.error("[search] assistant:", e.message);
      return NextResponse.json({ error: "The AI model didn't answer. Try again in a moment." }, { status: 502 });
    }
    throw e;
  } finally {
    done();
  }
});
