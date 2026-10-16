import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dialIntoMeeting } from "@/lib/calls";
import { nameOf } from "@/lib/people";
import { UserError, cleanEmail } from "@/lib/util";

export const dynamic = "force-dynamic";

function authorized(header: string | null): boolean {
  const token = process.env.PHONE_SVC_TOKEN || "";
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * For Meet, server to server (Bearer PHONE_SVC_TOKEN): call a phone number into a meeting.
 * { room, number, by } — `by` is the signed-in person asking; the call goes out from their number.
 */
export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = (await req.json().catch(() => ({}))) as { room?: string; number?: string; by?: string; byName?: string };
    const by = cleanEmail(b.by);
    const c = await dialIntoMeeting({ email: by, name: b.byName || (await nameOf(by)) }, String(b.room ?? ""), b.number);
    return NextResponse.json({ callId: c.id });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[phone] dial into meeting", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
