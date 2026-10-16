import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardStars } from "@/db/schema";
import { boardSnapshot } from "@/lib/board-snapshot";
import { notFound } from "next/navigation";
import { canAdminister, canWrite, requireBoard } from "@/lib/authz";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Membership first: a non-member gets the same 404 as a board that does not exist. Without this
  // the JSON routes refused a foreign board while this page rendered it, lists and cards included.
  const access = await requireBoard(id);
  if (!access) notFound();
  const snap = await boardSnapshot(id);
  if (!snap.board) notFound();
  const [star] = await db.select().from(boardStars)
    .where(and(eq(boardStars.boardId, id), eq(boardStars.userId, access.user.id)));
  return (
    <Board board={snap.board} initialLists={snap.lists} initialCards={snap.cards}
      canEdit={canWrite(access.role)} canAdmin={canAdminister(access.role)} initialStarred={!!star} />
  );
}
