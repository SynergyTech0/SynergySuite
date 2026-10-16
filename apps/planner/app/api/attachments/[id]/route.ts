import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, cards } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canWrite, forbidden, notFound, requireAttachment } from "@/lib/authz";
import { deleteUpload } from "@/lib/attachment-store";

// DELETE /api/attachments/[id] — remove an attachment, and clear it as the card's cover if it was one.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAttachment(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const [gone] = await db.delete(attachments).where(eq(attachments.id, id)).returning();
  if (gone) {
    // The row is the record; the file is only bytes. Remove them too, or the volume fills with
    // orphans nothing points at.
    await deleteUpload(gone.storageKey);
    await db.update(cards).set({ cover: null }).where(and(eq(cards.id, gone.cardId), eq(cards.cover, id)));
    await logActivity({ boardId: access.boardId, cardId: gone.cardId, userId: access.user.id, type: "attachment_removed", data: { attachmentId: id, name: gone.name } });
  }
  publish(access.boardId, { type: "changed" });
  return NextResponse.json({ ok: true });
}
