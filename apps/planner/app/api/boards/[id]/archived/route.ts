import { NextResponse } from "next/server";
import { db } from "@/db";
import { cards, lists } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { notFound, requireBoard } from "@/lib/authz";

// GET /api/boards/[id]/archived — everything hidden from the board snapshot.
// Archiving was already possible in the data model but nothing could show you what was archived,
// which makes archive a one-way door. This is the way back.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();

  const archivedCards = await db
    .select()
    .from(cards)
    .where(and(eq(cards.boardId, id), eq(cards.isArchived, true)))
    .orderBy(desc(cards.updatedAt));

  const archivedLists = await db
    .select()
    .from(lists)
    .where(and(eq(lists.boardId, id), eq(lists.isArchived, true)))
    .orderBy(desc(lists.position));

  return NextResponse.json({ cards: archivedCards, lists: archivedLists });
}
