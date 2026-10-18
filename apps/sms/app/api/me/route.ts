import { NextResponse } from "next/server";
import { currentUser } from "@/lib/api";
import { canUseSms } from "@/lib/access";
import { status } from "@/lib/sms";
import { publicUrl } from "@/lib/provider";

/** Who is signed in, whether they may use SMS, and which texting service it sends through. */
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ email: me.email, name: me.name, allowed: canUseSms(me.email), ...status(), webhook: publicUrl("/api/webhooks/twilio/inbound") });
}
