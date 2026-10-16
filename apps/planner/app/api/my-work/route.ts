import { NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, lists } from "@/db/schema";
import { notFound, visibleBoardIds } from "@/lib/authz";
import { getCurrentUserOrNull } from "@/lib/session";

/**
 * GET /api/my-work — the dashboard: what is assigned to me, what is late, and where each board
 * stands. Every query is bounded by visibleBoardIds, which makes this the widest read in the app and
 * the one where a missing scope would leak the most.
 *
 * Completed cards are never "overdue" or "due soon". A card finished after its due date is a fact
 * about the past, and a dashboard that keeps shouting about it trains people to ignore it.
 */
const WEEK = 7 * 86400000;

export async function GET(_req?: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const ids = await visibleBoardIds(user.id);
  if (!ids.length) return NextResponse.json({ assigned: [], overdue: 0, dueSoon: 0, boards: [] });

  const assigned = await db
    .select({
      id: cards.id, title: cards.title, issueKey: cards.issueKey, issueType: cards.issueType,
      priority: cards.priority, points: cards.points, dueDate: cards.dueDate, boardId: cards.boardId,
      boardTitle: boards.title, listTitle: lists.title,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(lists, eq(lists.id, cards.listId))
    .where(and(
      eq(cards.assigneeId, user.id), eq(cards.isComplete, false), eq(cards.isArchived, false),
      inArray(cards.boardId, ids),
    ))
    // Undated cards sort last rather than first: "no due date" is not "due at the beginning of time".
    .orderBy(sql`${cards.dueDate} asc nulls last`, asc(cards.position));

  const now = Date.now();
  const overdue = assigned.filter((c) => c.dueDate && c.dueDate.getTime() + 86400000 - 1 < now).length;
  const dueSoon = assigned.filter((c) => {
    if (!c.dueDate) return false;
    const end = c.dueDate.getTime() + 86400000 - 1;
    return end >= now && end - now <= WEEK;
  }).length;

  const counts = await db
    .select({
      id: boards.id, title: boards.title, keyPrefix: boards.keyPrefix,
      open: sql<number>`count(*) filter (where ${cards.isComplete} = false)`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${cards.isComplete} = true)`.mapWith(Number),
    })
    .from(boards)
    .leftJoin(cards, and(eq(cards.boardId, boards.id), eq(cards.isArchived, false)))
    .where(and(inArray(boards.id, ids), eq(boards.isClosed, false)))
    .groupBy(boards.id, boards.title, boards.keyPrefix)
    .orderBy(asc(boards.title));

  return NextResponse.json({ assigned, overdue, dueSoon, boards: counts });
}
