import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cardLabels, cardMembers, cards, checklistItems, checklists } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { afterLast } from "@/lib/position";
import { nextIssueKey } from "@/lib/issue-key";
import { canWrite, forbidden, notFound, requireCard, requireList } from "@/lib/authz";

/**
 * POST /api/cards/[id]/copy { title?, listId? } — Trello's "Copy card".
 *
 * Reading the source needs only visibility; the copy lands in `listId` (default: the same list) and
 * needs write access there. A copy is new work, so it gets its own issue key, starts incomplete, and
 * its checklist items start unticked. Labels and assignees come along only within the same board:
 * a label belongs to one board, and an assignee is only valid where they can see the card.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await requireCard(id);
  if (!source) return notFound();

  const body = await req.json().catch(() => ({}));
  const [card] = await db.select().from(cards).where(eq(cards.id, id));
  if (!card) return notFound();

  const target = await requireList(body.listId ? String(body.listId) : card.listId);
  if (!target) return notFound();
  if (!canWrite(target.role)) return forbidden();
  const sameBoard = target.boardId === card.boardId;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : card.title;

  const copy = await db.transaction(async (tx) => {
    const siblings = await tx.select({ position: cards.position }).from(cards).where(eq(cards.listId, target.listId));
    const [c] = await tx.insert(cards).values({
      listId: target.listId,
      boardId: target.boardId,
      title,
      description: card.description,
      position: afterLast(siblings.map((s) => s.position)),
      startDate: card.startDate,
      dueDate: card.dueDate,
      cover: card.cover && card.cover.startsWith("#") ? card.cover : null,  // an image cover points at the source's attachment
      issueKey: await nextIssueKey(target.boardId, tx),
      issueType: card.issueType,
      priority: card.priority,
      points: card.points,
      parentId: sameBoard ? card.parentId : null,
      createdBy: target.user.id,
    }).returning();

    const cls = await tx.select().from(checklists).where(eq(checklists.cardId, id)).orderBy(asc(checklists.position));
    if (cls.length) {
      const items = await tx.select().from(checklistItems)
        .where(inArray(checklistItems.checklistId, cls.map((x) => x.id))).orderBy(asc(checklistItems.position));
      for (const cl of cls) {
        const [ncl] = await tx.insert(checklists).values({ cardId: c.id, title: cl.title, position: cl.position }).returning();
        const mine = items.filter((i) => i.checklistId === cl.id);
        if (mine.length) {
          await tx.insert(checklistItems).values(mine.map((i) => ({
            checklistId: ncl.id, text: i.text, position: i.position, isChecked: false,
            assigneeId: sameBoard ? i.assigneeId : null, dueDate: i.dueDate,
          })));
        }
      }
    }

    if (sameBoard) {
      const ls = await tx.select().from(cardLabels).where(eq(cardLabels.cardId, id));
      if (ls.length) await tx.insert(cardLabels).values(ls.map((l) => ({ cardId: c.id, labelId: l.labelId })));
      const ms = await tx.select().from(cardMembers).where(eq(cardMembers.cardId, id));
      if (ms.length) await tx.insert(cardMembers).values(ms.map((m) => ({ cardId: c.id, userId: m.userId })));
    }
    return c;
  });

  await logActivity({
    boardId: target.boardId, cardId: copy.id, userId: target.user.id, type: "card_created",
    data: { title: copy.title, copiedFrom: card.issueKey ?? card.title },
  });
  publish(target.boardId, { type: "changed" });
  return NextResponse.json(copy, { status: 201 });
}
