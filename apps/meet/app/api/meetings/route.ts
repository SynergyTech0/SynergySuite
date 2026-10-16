import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { createMeeting, listForHost, dispatchInvites, type Recurrence } from "@/lib/meetings";

export const dynamic = "force-dynamic";

/** GET: the signed-in host's meetings. POST: schedule a new one + send invites. Staff only. */
export async function GET() {
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    return NextResponse.json({ meetings: await listForHost(email) });
  } catch (e) {
    console.error("[meetings] list failed:", e);
    return NextResponse.json({ error: "Could not load meetings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim().slice(0, 200);
  const startAt = String(body.startAt || "");
  const durationMin = Math.min(600, Math.max(5, Number(body.durationMin) || 30));
  if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  if (!startAt || isNaN(Date.parse(startAt)))
    return NextResponse.json({ error: "A valid start time is required" }, { status: 400 });

  const recurrence: Recurrence = body.recurrence
    ? {
        freq: body.recurrence.freq,
        interval: Number(body.recurrence.interval) || 1,
        byday: Array.isArray(body.recurrence.byday) ? body.recurrence.byday : undefined,
        count: body.recurrence.count ? Number(body.recurrence.count) : undefined,
        until: body.recurrence.until || undefined,
      }
    : null;
  if (recurrence && !["DAILY", "WEEKLY", "MONTHLY"].includes(recurrence.freq))
    return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

  const invitees = (Array.isArray(body.invitees) ? body.invitees : [])
    .map((x: any) => (typeof x === "string" ? { email: x } : { email: String(x.email || ""), name: x.name }))
    .filter((x: any) => x.email);

  try {
    const m = await createMeeting({
      title,
      description: String(body.description || "").slice(0, 2000),
      hostEmail: email,
      hostName: session!.user!.name || email,
      startAt: new Date(startAt).toISOString(),
      durationMin,
      timezone: String(body.timezone || "UTC"),
      recurrence,
      invitees,
    });
    const results = await dispatchInvites(m, "REQUEST");
    return NextResponse.json({ meeting: m, invites: results });
  } catch (e) {
    console.error("[meetings] create failed:", e);
    return NextResponse.json({ error: "Could not schedule the meeting" }, { status: 500 });
  }
}
