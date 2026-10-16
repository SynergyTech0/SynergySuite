import { db } from "@/db";
import { boards, cards, sprints } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { canWrite, requireBoard } from "@/lib/authz";
import { Backlog } from "./Backlog";

export const dynamic = "force-dynamic";

export default async function BacklogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Same guard as the board page: sprints and cards are board data, so membership decides access.
  const access = await requireBoard(id);
  if (!access) notFound();
  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) notFound();

  const sp = await db.select().from(sprints)
    .where(eq(sprints.boardId, id)).orderBy(asc(sprints.createdAt));
  const cs = await db.select().from(cards)
    .where(and(eq(cards.boardId, id), eq(cards.isArchived, false))).orderBy(asc(cards.position));

  return <Backlog board={board} initialSprints={sp} initialCards={cs} canEdit={canWrite(access.role)} />;
}
