import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Calls a phone number into this meeting through Synergy Phone. Staff only; the call goes out
 * from the host's own phone number, and Phone keeps it in their call history. Server to server
 * with PHONE_SVC_TOKEN, so the browser never talks to Phone's machine API.
 */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Only signed-in staff can call phones in" }, { status: 403 });
  const token = process.env.PHONE_SVC_TOKEN;
  if (!token) return NextResponse.json({ error: "Calling phones into meetings isn't set up (PHONE_SVC_TOKEN)" }, { status: 503 });
  const { room, number } = await req.json().catch(() => ({}));
  if (!room || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(room)) || !number) {
    return NextResponse.json({ error: "room and number are required" }, { status: 400 });
  }
  const base = (process.env.PHONE_INTERNAL_URL || (process.env.NODE_ENV === "production" ? "http://phone:3440" : "http://localhost:3440")).replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/api/svc/dial`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room, number: String(number).slice(0, 40), by: session.user.email, byName: session.user.name }),
      signal: AbortSignal.timeout(10_000),
    });
    const d = await r.json().catch(() => ({}));
    return NextResponse.json(d, { status: r.status });
  } catch {
    return NextResponse.json({ error: "Synergy Phone isn't answering" }, { status: 502 });
  }
}
