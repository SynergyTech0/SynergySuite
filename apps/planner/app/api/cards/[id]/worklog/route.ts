import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, workLogs } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { parseDuration } from "@/lib/duration";
import { parseDate } from "@/lib/validate";
import { canWrite, forbidden, notFound, requireCard } from "@/lib/authz";

/**
 * POST /api/cards/[id]/worklog { spent, comment?, startedAt?, remaining? } — log work.
 *
 * Logging adds to timeSpent and, by default, takes the same amount off the remaining estimate
 * (Jira's "adjust automatically"), never below zero. Passing `remaining` sets it instead, which is
 * Jira's "set to" — useful when the work turned out bigger than the time spent on it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireCard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const minutes = parseDuration(String(body.spent ?? ""));
  if (minutes === null || minutes <= 0) {
    return NextResponse.json({ error: "spent must be a duration like 90m, 2h or 1d 4h" }, { status: 400 });
  }
  const startedAt = parseDate(body.startedAt ?? null) ?? new Date();
  let remaining: number | null | undefined;
  if (body.remaining !== undefined && body.remaining !== null) {
    remaining = parseDuration(String(body.remaining));
    if (remaining === null) return NextResponse.json({ error: "remaining must be a duration" }, { status: 400 });
  }

  const [card] = await db.select().from(cards).where(eq(cards.id, id));
  if (!card) return notFound();
  const nextRemaining = remaining !== undefined
    ? remaining
    : card.remainingEstimate === null ? null : Math.max(0, card.remainingEstimate - minutes);

  const [entry] = await db.insert(workLogs).values({
    cardId: id, userId: access.user.id, minutes, comment: typeof body.comment === "string" ? body.comment.slice(0, 500) : null, startedAt,
  }).returning();
  await db.update(cards)
    .set({ timeSpent: sql`${cards.timeSpent} + ${minutes}`, remainingEstimate: nextRemaining, updatedAt: new Date() })
    .where(eq(cards.id, id));

  await logActivity({
    boardId: access.boardId, cardId: id, userId: access.user.id, type: "card_updated",
    data: { field: "worklog", logged: minutes, remaining: nextRemaining },
  });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(entry, { status: 201 });
}
