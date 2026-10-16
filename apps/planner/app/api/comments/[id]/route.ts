import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canAdminister, canWrite, forbidden, notFound, requireComment } from "@/lib/authz";

/**
 * Edit or delete a comment.
 *
 * Editing is the author's alone — an admin rewriting what someone said, under that person's name, is
 * not moderation. Deleting is the author's, or a board admin's (removing an abusive or leaked-secret
 * comment is). The mind's comments have no human author, so only an admin can remove them and no one
 * can put words in its mouth.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireComment(id);
  if (!access) return notFound();
  const [comment] = await db.select().from(comments).where(eq(comments.id, id));
  if (!comment) return notFound();
  if (!canWrite(access.role) || comment.userId !== access.user.id) return forbidden();

  const { body } = await req.json();
  if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });

  const [updated] = await db.update(comments)
    .set({ body: body.trim(), editedAt: new Date() })
    .where(eq(comments.id, id)).returning();
  await logActivity({ boardId: access.boardId, cardId: comment.cardId, userId: access.user.id, type: "comment_edited", data: { commentId: id } });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireComment(id);
  if (!access) return notFound();
  const [comment] = await db.select().from(comments).where(eq(comments.id, id));
  if (!comment) return notFound();
  const isAuthor = comment.userId === access.user.id && canWrite(access.role);
  if (!isAuthor && !canAdminister(access.role)) return forbidden();

  await db.delete(comments).where(eq(comments.id, id));
  await logActivity({
    boardId: access.boardId, cardId: comment.cardId, userId: access.user.id, type: "comment_deleted",
    data: { commentId: id, byAuthor: isAuthor },
  });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
