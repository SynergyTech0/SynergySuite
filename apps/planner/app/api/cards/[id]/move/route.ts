import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boards, cardLabels, cardMembers, cards, lists } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity, recordCardChanges } from "@/lib/activity";
import { afterLast } from "@/lib/position";
import { nextIssueKey } from "@/lib/issue-key";
import { completionOnMove } from "@/lib/workflow";
import { canSeeBoard, canWrite, forbidden, notFound, requireCard, requireList } from "@/lib/authz";

/**
 * POST /api/cards/[id]/move { listId, position? } — move a card to any list, including one on another
 * board (Trello "Move", Jira "Move issue").
 *
 * Needs write access on both boards. Crossing boards changes what the card may refer to:
 *  - it takes the target board's issue key (the old key is kept in history, as Jira does);
 *  - sprint and parent are cleared, and so is the parent link of any child left behind, because
 *    both are board-scoped and a cross-board reference is exactly the leak cards PATCH refuses;
 *  - labels are dropped (a label id belongs to one board);
 *  - members and the assignee stay only if they can see the target board.
 * Checklists, comments, attachments and the card's own history travel with it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await requireCard(id);
  if (!source) return notFound();
  if (!canWrite(source.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (!body.listId) return NextResponse.json({ error: "listId required" }, { status: 400 });
  const target = await requireList(String(body.listId));
  if (!target) return notFound();
  if (!canWrite(target.role)) return forbidden();

  const [before] = await db.select().from(cards).where(eq(cards.id, id));
  if (!before) return notFound();
  const siblings = await db.select({ position: cards.position }).from(cards).where(eq(cards.listId, target.listId));
  const position = typeof body.position === "number" ? body.position : afterLast(siblings.map((s) => s.position));

  // Same board: an ordinary move between lists.
  if (target.boardId === before.boardId) {
    const completion = await completionOnMove(before, target.listId);
    const [after] = await db.update(cards).set({ listId: target.listId, position, updatedAt: new Date(), ...completion }).where(eq(cards.id, id)).returning();
    await recordCardChanges(source.user.id, before, after);
    publish(after.boardId, { type: "changed" });
    return NextResponse.json(after);
  }

  const completion = await completionOnMove(before, target.listId);
  const after = await db.transaction(async (tx) => {
    const [moved] = await tx.update(cards).set({
      listId: target.listId,
      boardId: target.boardId,
      position,
      issueKey: await nextIssueKey(target.boardId, tx),
      sprintId: null,
      parentId: null,
      updatedAt: new Date(),
      ...completion,
    }).where(eq(cards.id, id)).returning();

    await tx.update(cards).set({ parentId: null, updatedAt: new Date() })
      .where(and(eq(cards.parentId, id), eq(cards.boardId, before.boardId)));
    await tx.delete(cardLabels).where(eq(cardLabels.cardId, id));
    return moved;
  });

  const assignees = await db.select().from(cardMembers).where(eq(cardMembers.cardId, id));
  for (const a of assignees) {
    if (!(await canSeeBoard(a.userId, target.boardId))) {
      await db.delete(cardMembers).where(and(eq(cardMembers.cardId, id), eq(cardMembers.userId, a.userId)));
    }
  }

  // The Jira assignee is dropped on the same rule: they would own a card on a board they cannot see.
  if (after.assigneeId && !(await canSeeBoard(after.assigneeId, target.boardId))) {
    await db.update(cards).set({ assigneeId: null }).where(eq(cards.id, id));
    after.assigneeId = null;
  }

  const bs = await db.select({ id: boards.id, title: boards.title }).from(boards)
    .where(inArray(boards.id, [before.boardId, target.boardId]));
  const boardName = (bid: string) => bs.find((b) => b.id === bid)?.title ?? null;
  const [fromList] = await db.select({ title: lists.title }).from(lists).where(eq(lists.id, before.listId));
  const [toList] = await db.select({ title: lists.title }).from(lists).where(eq(lists.id, target.listId));

  await logActivity({
    boardId: target.boardId, cardId: id, userId: source.user.id, type: "card_moved",
    data: {
      fromBoard: boardName(before.boardId), toBoard: boardName(target.boardId),
      from: fromList?.title ?? null, to: toList?.title ?? null, previousKey: before.issueKey,
    },
  });
  // The old board is told too, so the card disappears there without a reload.
  publish(before.boardId, { type: "changed" });
  publish(target.boardId, { type: "changed" });
  return NextResponse.json(after);
}
