import { NextResponse } from "next/server";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { canWrite, forbidden, notFound, requireCard } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { cards } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mentionedIds, notify, plainMentions, watch, watcherIds } from "@/lib/notify";

// Human comments. The mind posts with origin "mind" into the same table via /api/mind.
export async function POST(req: Request) {
  const { cardId, body } = await req.json();
  if (!cardId || !body?.trim()) return NextResponse.json({ error: "cardId + body required" }, { status: 400 });
  const access = await requireCard(cardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();
  const [c] = await db.insert(comments)
    .values({ cardId, userId: access.user.id, origin: "human", body: body.trim() }).returning();
  await logActivity({ boardId: access.boardId, cardId, userId: access.user.id, type: "comment_added", data: { commentId: c.id, excerpt: c.body.slice(0, 140) } });
  // Commenting makes you a watcher, as in Jira. Mentioned people hear about it as a mention; every
  // other watcher hears about it as a comment — never both.
  await watch(cardId, access.user.id);
  const [card] = await db.select({ title: cards.title, issueKey: cards.issueKey }).from(cards).where(eq(cards.id, cardId));
  const excerpt = plainMentions(c.body).slice(0, 200);
  const mentioned = await notify({
    recipients: mentionedIds(c.body), actorId: access.user.id, type: "mentioned",
    boardId: access.boardId, cardId, data: { excerpt, where: "comment", title: card?.title },
  });
  await notify({
    recipients: await watcherIds(cardId), exclude: mentioned, actorId: access.user.id, type: "commented",
    boardId: access.boardId, cardId, data: { excerpt, title: card?.title },
  });
  return NextResponse.json({ ...c, author: access.user.name }, { status: 201 });
}
