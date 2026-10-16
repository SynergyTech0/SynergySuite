import { NextRequest, NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { markRead, notificationsFor } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// The signed-in person's notifications (mentions in comments).
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json(await notificationsFor(me));
}

// Mark some ({ids: [...]}) or all ({all: true}) as read.
export async function POST(req: NextRequest) {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: boolean };
  await markRead(me, body.all ? "all" : Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : []);
  return NextResponse.json({ ok: true });
}
