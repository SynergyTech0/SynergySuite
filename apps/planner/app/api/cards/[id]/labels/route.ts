import { NextResponse } from "next/server";
import { db } from "@/db";
import { cardLabels, labels } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { boardOfLabel, canWrite, forbidden, notFound, requireCard } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { labelId } = await req.json();
  if (!labelId) return NextResponse.json({ error: "labelId required" }, { status: 400 });
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  // The label must live on the same board as the card, or a board-A label lands on a board-B card.
  if ((await boardOfLabel(labelId)) !== access.boardId) return notFound();
  const added = await db.insert(cardLabels).values({ cardId: id, labelId }).onConflictDoNothing().returning();
  if (added.length) {
    const [l] = await db.select().from(labels).where(eq(labels.id, labelId));
    await logActivity({ boardId: access.boardId, cardId: id, userId: access.user.id, type: "label_added", data: { name: l?.name ?? null, color: l?.color ?? null } });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { labelId } = await req.json();
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const removed = await db.delete(cardLabels).where(and(eq(cardLabels.cardId, id), eq(cardLabels.labelId, labelId))).returning();
  if (removed.length) {
    const [l] = await db.select().from(labels).where(eq(labels.id, labelId));
    await logActivity({ boardId: access.boardId, cardId: id, userId: access.user.id, type: "label_removed", data: { name: l?.name ?? null, color: l?.color ?? null } });
  }
  return NextResponse.json({ ok: true });
}
