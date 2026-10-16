import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { notFound, requireAttachment } from "@/lib/authz";
import { readUpload, servedType } from "@/lib/attachment-store";

/**
 * GET /api/attachments/[id]/file — the bytes, to anyone who can see the card.
 *
 * The response type comes from the allow-list in lib/attachment-store, never from what the uploader
 * declared: serving a user-supplied HTML or SVG file as itself, from our own origin, is stored XSS.
 * nosniff stops the browser second-guessing that decision.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAttachment(id);
  if (!access) return notFound();

  const [att] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!att?.storageKey) return notFound();
  const bytes = await readUpload(att.storageKey);
  if (!bytes) return notFound();

  const { type, disposition } = servedType(att.mime);
  // The filename is quoted and stripped of quotes: a header cannot be split by a crafted name.
  const filename = att.name.replace(/["\\r\n]/g, "");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "content-length": String(bytes.byteLength),
      "content-disposition": `${disposition}; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}
