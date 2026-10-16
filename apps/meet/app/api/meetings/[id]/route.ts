import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { getMeeting, cancelMeeting, rescheduleMeeting, dispatchInvites, type Recurrence } from "@/lib/meetings";

export const dynamic = "force-dynamic";

/** Only the host may change or cancel their own meeting. */
async function ownedOr404(id: string, email: string) {
  const m = await getMeeting(id);
  if (!m || m.host_email !== email) return null; // 404, don't confirm existence to others
  return m;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(await ownedOr404(id, email))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const m = await cancelMeeting(id);
  if (m) await dispatchInvites(m, "CANCEL"); // withdraw it from invitees' calendars
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(await ownedOr404(id, email))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const recurrence: Recurrence | undefined =
    body.recurrence === undefined ? undefined
      : body.recurrence === null ? null
      : { freq: body.recurrence.freq, interval: Number(body.recurrence.interval) || 1,
          byday: body.recurrence.byday, count: body.recurrence.count ? Number(body.recurrence.count) : undefined,
          until: body.recurrence.until || undefined };

  const m = await rescheduleMeeting(id, {
    title: body.title, description: body.description,
    startAt: body.startAt ? new Date(body.startAt).toISOString() : undefined,
    durationMin: body.durationMin ? Number(body.durationMin) : undefined,
    timezone: body.timezone, recurrence,
    invitees: Array.isArray(body.invitees)
      ? body.invitees.map((x: any) => (typeof x === "string" ? { email: x } : x))
      : undefined,
  });
  if (m) await dispatchInvites(m, "REQUEST"); // updated invite (SEQUENCE bumped) re-syncs calendars
  return NextResponse.json({ meeting: m });
}
