import { NextResponse } from "next/server";
import { webhooks } from "@/lib/livekit";
import { type LkEvent, handleWebhook } from "@/lib/webhook";

export const dynamic = "force-dynamic";

/**
 * LiveKit's webhooks (set in the media server's config, see apps/phone/README.md). Reached
 * without a suite sign-in; every event is signed with the media server's API secret.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: LkEvent;
  try {
    event = (await webhooks().receive(raw, req.headers.get("authorization") ?? undefined)) as unknown as LkEvent;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await handleWebhook(event);
  } catch (e) {
    console.error("[phone] webhook", event.event, (e as Error).message);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
