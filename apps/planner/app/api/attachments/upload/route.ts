import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { publish } from "@/lib/bus";
import { logActivity } from "@/lib/activity";
import { canWrite, forbidden, notFound, requireCard } from "@/lib/authz";
import { MAX_UPLOAD, safeName, saveUpload } from "@/lib/attachment-store";

/**
 * POST /api/attachments/upload — multipart: a real file on a card, rather than a link to one.
 *
 * The bytes are read before anything is written, so an oversized upload is refused without leaving a
 * partial file behind, and the row is only written once the file is safely on disk: an attachment
 * row pointing at nothing is worse than an upload that failed cleanly.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected a multipart upload" }, { status: 400 });

  const cardId = String(form.get("cardId") ?? "");
  const access = await requireCard(cardId);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file was sent" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "that file is empty" }, { status: 400 });
  if (file.size > MAX_UPLOAD) {
    return NextResponse.json({ error: `that file is larger than ${MAX_UPLOAD / 1024 / 1024}MB` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the length we actually received, not the one the client declared.
  if (bytes.byteLength > MAX_UPLOAD) {
    return NextResponse.json({ error: `that file is larger than ${MAX_UPLOAD / 1024 / 1024}MB` }, { status: 413 });
  }
  const storageKey = await saveUpload(bytes);
  const name = safeName(String(form.get("name") || file.name || "file"));

  const [att] = await db.insert(attachments).values({
    cardId, name, storageKey, sizeBytes: bytes.byteLength,
    mime: file.type ? file.type.slice(0, 100) : null,
    createdBy: access.user.id,
  }).returning();

  await logActivity({
    boardId: access.boardId, cardId, userId: access.user.id,
    type: "attachment_added", data: { attachmentId: att.id, name },
  });
  publish(access.boardId, { type: "changed" });
  return NextResponse.json(att, { status: 201 });
}
