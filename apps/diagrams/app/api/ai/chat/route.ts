import { NextResponse } from "next/server";
import { AiRequestError, AiUnavailableError, chat } from "@synergy/ai";
import { currentUser } from "@/lib/api";
import { AiInputError, MAX_AI_REQUEST, aiConfigForDiagrams, readChat } from "@/lib/ai";

/** draw.io reads `error.message` from a failed answer, as OpenAI sends it. */
function error(message: string, status: number): Response {
  return NextResponse.json({ error: { message } }, { status });
}

/** The editor's AI window, in OpenAI's chat format, answered by the suite's model. */
export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") || req.headers.get("host"))) {
    return error("Cross-site request refused", 403);
  }
  if (!(await currentUser())) return error("Sign in required", 401);
  const config = await aiConfigForDiagrams();
  if (!config) return error("AI is off: the administrator hasn't set up an AI model for the suite.", 503);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_AI_REQUEST) return error("That diagram is too large to send to the AI model", 413);
  try {
    const { system, prompt } = readChat(JSON.parse(raw));
    const content = await chat({ system, prompt, maxTokens: 8192, config });
    return NextResponse.json({ object: "chat.completion", model: config.model, choices: [{ index: 0, message: { role: "assistant", content } }] });
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof AiInputError) return error(e instanceof AiInputError ? e.message : "Bad request body", 400);
    if (e instanceof AiUnavailableError) return error(e.message, 503);
    if (e instanceof AiRequestError) return error(`The AI model didn't answer: ${e.message}`, 502);
    console.error("[diagrams] ai", e);
    return error("Something went wrong", 500);
  }
}
