import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardStars } from "@/db/schema";
import { notFound, requireBoard } from "@/lib/authz";

// Star or unstar a board for the caller. A star is personal and changes nothing anyone else sees, so
// it needs visibility only — an observer can star a board they watch.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  await db.insert(boardStars).values({ userId: access.user.id, boardId: id }).onConflictDoNothing();
  return NextResponse.json({ starred: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  await db.delete(boardStars).where(and(eq(boardStars.userId, access.user.id), eq(boardStars.boardId, id)));
  return NextResponse.json({ starred: false });
}
