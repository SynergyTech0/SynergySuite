import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { finalizeDocument } from "@/lib/finalize";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/[id]/finalize — (re)generate the signed PDF for a fully-signed document.
 *
 * Recovery path: if finalization failed at signing time (storage hiccup, etc.) the document is left
 * un-finalized rather than falsely marked COMPLETED, and the owner can retry here instead of being
 * stuck with a document that says "signed" but has no PDF.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await prisma.document.findUnique({
    where: { id: params.id },
    select: { id: true, senderId: true, signedDocumentPath: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (document.senderId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await finalizeDocument(params.id);

    await prisma.auditLog.create({
      data: {
        documentId: params.id,
        action: "DOCUMENT_COMPLETED",
        details: `Signed PDF generated (${result.signedFilename}), hash ${result.documentHash.slice(0, 16)}…`,
      },
    });

    return NextResponse.json({
      success: true,
      signedDocumentPath: result.storageKey,
      documentHash: result.documentHash,
      regenerated: Boolean(document.signedDocumentPath),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[Finalize] failed:", err);
    return NextResponse.json({ error: reason }, { status: 400 });
  }
}
