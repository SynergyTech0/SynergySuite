import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, workLogs } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canAdminister, canWrite, forbidden, isUuid, notFound, requireCard } from "@/lib/authz";

/**
 * DELETE /api/worklog/[id] — remove a log entry and give the time back: timeSpent goes down, and the
 * remaining estimate goes up by the same amount (the inverse of logging it). The author or a board
 * admin only — a log entry is a statement about someone's own day.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const [entry] = await db.select().from(workLogs).where(eq(workLogs.id, id));
  if (!entry) return notFound();

  const access = await requireCard(entry.cardId);
  if (!access) return notFound();
  const isAuthor = entry.userId === access.user.id && canWrite(access.role);
  if (!isAuthor && !canAdminister(access.role)) return forbidden();

  const [card] = await db.select().from(cards).where(eq(cards.id, entry.cardId));
  await db.delete(workLogs).where(eq(workLogs.id, id));
  await db.update(cards).set({
    timeSpent: sql`greatest(0, ${cards.timeSpent} - ${entry.minutes})`,
    remainingEstimate: card?.remainingEstimate === null ? null : (card?.remainingEstimate ?? 0) + entry.minutes,
    updatedAt: new Date(),
  }).where(eq(cards.id, entry.cardId));

  await logActivity({
    boardId: access.boardId, cardId: entry.cardId, userId: access.user.id, type: "card_updated",
    data: { field: "worklog", removed: entry.minutes },
  });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
