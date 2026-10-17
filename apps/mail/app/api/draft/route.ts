import { NextResponse } from "next/server";
import { AiRequestError, AiUnavailableError } from "@synergy/ai";
import { identify, optionsFromEnv } from "@synergy/identity";
import { UserError } from "@/lib/accounts";
import { AI_OFF, draft, mailAiConfig, readDraft } from "@/lib/draft";

export const dynamic = "force-dynamic";

/** A page on another site (or another suite app) can't use the person's model quota through Mail. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") || req.headers.get("host"));
  } catch {
    return false;
  }
}

/** POST { mode, instructions?, mine?, thread?, subject?, to? } → { text }: a draft for compose. Sends nothing. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const me = identify(req.headers, optionsFromEnv());
  if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const config = await mailAiConfig();
  if (!config) return NextResponse.json({ error: AI_OFF, aiOff: true }, { status: 503 });
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new UserError("Bad request body");
    }
    const input = readDraft(body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {});
    return NextResponse.json({ text: await draft(input, `${me.name} <${me.email}>`, config) });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof AiUnavailableError) return NextResponse.json({ error: AI_OFF, aiOff: true }, { status: 503 });
    if (e instanceof AiRequestError) {
      console.error("[mail] draft:", e.message);
      return NextResponse.json({ error: "The AI model didn't answer. Try again in a moment." }, { status: 502 });
    }
    console.error("[mail] draft:", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
