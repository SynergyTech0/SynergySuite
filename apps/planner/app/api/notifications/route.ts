import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { cards, notifications, users } from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound, visibleBoardIds } from "@/lib/authz";

/**
 * GET /api/notifications — the caller's latest notifications and unread count.
 *
 * Filtered to boards the caller can see NOW, not when the notification was written: someone removed
 * from a board should stop seeing its card titles and comment excerpts in their bell.
 */
export async function GET(req?: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const visible = await visibleBoardIds(user.id);
  if (!visible.length) return NextResponse.json({ items: [], unread: 0 });

  const limit = Math.min(Number(req ? new URL(req.url).searchParams.get("limit") : 0) || 30, 100);
  const mine = and(eq(notifications.userId, user.id), inArray(notifications.boardId, visible));
  const items = await db.select({
    id: notifications.id, type: notifications.type, data: notifications.data, readAt: notifications.readAt,
    createdAt: notifications.createdAt, boardId: notifications.boardId, cardId: notifications.cardId,
    cardTitle: cards.title, issueKey: cards.issueKey, actor: users.name, actorIsMind: users.isMind,
  }).from(notifications)
    .leftJoin(cards, eq(cards.id, notifications.cardId))
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(mine).orderBy(desc(notifications.createdAt)).limit(limit);
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt)));
  return NextResponse.json({ items, unread: n });
}
