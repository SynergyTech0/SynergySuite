import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";
import { isUuid, notFound } from "@/lib/authz";

// POST /api/notifications/read { ids: [...] } or { all: true } — only ever the caller's own.
export async function POST(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const body = await req.json().catch(() => ({}));
  const mine = and(eq(notifications.userId, user.id), isNull(notifications.readAt));
  if (body.all === true) {
    await db.update(notifications).set({ readAt: new Date() }).where(mine);
  } else {
    const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
    if (!ids.length) return NextResponse.json({ error: "ids or all required" }, { status: 400 });
    await db.update(notifications).set({ readAt: new Date() }).where(and(mine, inArray(notifications.id, ids)));
  }
  return NextResponse.json({ ok: true });
}
