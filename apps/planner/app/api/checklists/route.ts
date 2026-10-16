import { NextResponse } from "next/server";
import { db } from "@/db";
import { checklists } from "@/db/schema";
import { eq } from "drizzle-orm";
import { afterLast } from "@/lib/position";
import { canWrite, forbidden, notFound, requireCard } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

export async function POST(req: Request) {
  const { cardId, title } = await req.json();
  if (!cardId || !title?.trim()) return NextResponse.json({ error: "cardId + title required" }, { status: 400 });
  const access = await requireCard(cardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const existing = await db.select({ position: checklists.position }).from(checklists).where(eq(checklists.cardId, cardId));
  const [cl] = await db.insert(checklists)
    .values({ cardId, title: title.trim(), position: afterLast(existing.map((c) => c.position)) }).returning();
  await logActivity({ boardId: access.boardId, cardId, userId: access.user.id, type: "checklist_added", data: { title: cl.title } });
  return NextResponse.json({ ...cl, items: [] }, { status: 201 });
}
