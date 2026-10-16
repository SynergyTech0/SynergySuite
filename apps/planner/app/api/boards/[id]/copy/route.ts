import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cardLabels, cards, checklistItems, checklists, labels, lists } from "@/db/schema";
import { notFound, requireBoard } from "@/lib/authz";
import { createBoardFrom } from "@/lib/create-board";
import type { ImportBoard } from "@/lib/import-trello";

/**
 * POST /api/boards/[id]/copy — { title?, withCards? } → a new board in the caller's own workspace.
 *
 * withCards: false is what a template is: the columns, the labels and nothing else. Comments,
 * history, attachments, members and sprints are deliberately not copied — they describe what
 * happened on the original board, and carrying them over would put words in people's mouths on a
 * board they have not seen.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();

  const body = await req.json().catch(() => ({}));
  const withCards = body?.withCards !== false;

  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) return notFound();

  const cols = await db.select().from(lists).where(eq(lists.boardId, id)).orderBy(asc(lists.position));
  const boardLabels = await db.select().from(labels).where(eq(labels.boardId, id));
  const labelName = new Map(boardLabels.map((l) => [l.id, l.name ?? l.color]));

  const rows = withCards
    ? await db.select().from(cards).where(eq(cards.boardId, id)).orderBy(asc(cards.position))
    : [];
  const ids = rows.map((c) => c.id);
  const links = ids.length ? await db.select().from(cardLabels) : [];
  const labelsOf = (cardId: string) =>
    links.filter((l) => l.cardId === cardId).map((l) => labelName.get(l.labelId)).filter(Boolean) as string[];

  const ks = ids.length ? await db.select().from(checklists) : [];
  const items = ids.length ? await db.select().from(checklistItems) : [];
  const checklistsOf = (cardId: string) =>
    ks.filter((k) => k.cardId === cardId).sort((a, b) => a.position - b.position).map((k) => ({
      title: k.title,
      items: items.filter((i) => i.checklistId === k.id).sort((a, b) => a.position - b.position)
        .map((i) => ({ title: i.text, isDone: i.isChecked })),
    }));

  const spec: ImportBoard = {
    title: (typeof body?.title === "string" && body.title.trim()) || `${board.title} (copy)`,
    labels: boardLabels.map((l) => ({ name: l.name ?? l.color, color: l.color })),
    lists: cols.map((col, i) => ({
      title: col.title,
      position: (i + 1) * 1024,
      cards: rows.filter((c) => c.listId === col.id && !c.isArchived).map((c, j) => ({
        title: c.title,
        description: c.description ?? "",
        position: (j + 1) * 1024,
        dueDate: c.dueDate ? c.dueDate.toISOString() : null,
        isComplete: c.isComplete,
        labels: labelsOf(c.id),
        checklists: checklistsOf(c.id),
        comments: [],
        issueType: c.issueType,
        priority: c.priority,
        points: c.points,
      })),
    })),
    skipped: withCards
      ? ["comments, history, attachments and sprints stay with the original board"]
      : ["cards — this is a copy of the board's structure only"],
  };

  const made = await createBoardFrom(spec, access.user.id, access.user.name);
  return NextResponse.json(made, { status: 201 });
}
