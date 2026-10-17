import { NextResponse, type NextRequest } from "next/server";
import { AiRequestError, AiUnavailableError, relay } from "@synergy/ai";
import { currentUser } from "@/lib/session";
import { MAX_AI_REQUEST, aiConfigForCad, relayProtocol } from "@/lib/ai";

/**
 * The 3D modeling assistant's model calls: Chili3D's own Anthropic or OpenAI client posts here
 * (`/api/ai/anthropic/v1/messages` or `/api/ai/openai/chat/completions`), and the request goes on
 * to the suite's configured model with the server's key. See lib/ai.ts.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ protocol: string; path: string[] }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: { message: "Not signed in" } }, { status: 401 });
  const { protocol: name, path } = await ctx.params;
  const protocol = relayProtocol(name, path);
  if (!protocol) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AI_REQUEST) {
    return NextResponse.json({ error: { message: "Request too large" } }, { status: 413 });
  }
  const text = await req.text();
  if (text.length > MAX_AI_REQUEST) return NextResponse.json({ error: { message: "Request too large" } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: { message: "Expected a JSON body" } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { message: "Expected a JSON object" } }, { status: 400 });
  }
  try {
    const upstream = await relay(body as Record<string, unknown>, {
      config: await aiConfigForCad(),
      protocol,
      headers: { "anthropic-version": req.headers.get("anthropic-version"), "anthropic-beta": req.headers.get("anthropic-beta") },
      signal: req.signal,
    });
    const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: { message: e.message } }, { status: 503 });
    if (e instanceof AiRequestError) return NextResponse.json({ error: { message: e.message } }, { status: 502 });
    throw e;
  }
}
