/**
 * Document finalization — the step that turns "everyone clicked sign" into an actual signed PDF.
 *
 * This lives in one place because it has exactly one correctness rule: a document is only COMPLETED
 * if the signed PDF genuinely exists. Previously this ran inline in the signing route, guessed a
 * local path the uploader never wrote to, threw, and then marked the document COMPLETED anyway —
 * producing documents that claimed to be signed but had no PDF, no hash and no certificate.
 *
 * All IO goes through lib/storage so local/s3/hybrid modes all work.
 */

import { prisma } from "@/lib/db";
import { createSignedPdfBuffer, generateSignedFilename, SignatureData } from "@/lib/pdf-signer";
import { hashBuffer } from "@/lib/document-hash";
import { getFileBuffer, uploadFile } from "@/lib/storage";
import { enqueueContractEventSafe } from "@/lib/contract-events";

export interface FinalizedDocument {
  signedPdf: Buffer;
  signedFilename: string;
  storageKey: string;
  documentHash: string;
}

/**
 * Stamp every signed field into the original PDF, persist it, hash it, and mark the document
 * COMPLETED. Throws if the PDF cannot be produced — the caller must NOT claim completion.
 * Idempotent enough to be used as a retry: re-running simply regenerates and overwrites.
 */
export async function finalizeDocument(documentId: string): Promise<FinalizedDocument> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { signers: true, fields: true },
  });
  if (!document) throw new Error(`Document ${documentId} not found`);

  const outstanding = document.signers.filter((s) => s.status !== "COMPLETED");
  if (outstanding.length > 0) {
    throw new Error(
      `Cannot finalize: ${outstanding.length} signer(s) have not completed (${outstanding
        .map((s) => s.email)
        .join(", ")})`,
    );
  }

  // Read the original through storage — never guess a filesystem path.
  const originalPdf = await getFileBuffer(document.cloudStoragePath, document.cloudProvider);

  const signatures: SignatureData[] = [];
  for (const signer of document.signers) {
    const filled = document.fields.filter((f) => f.assignedToId === signer.id && f.value);
    for (const field of filled) {
      const isImage = field.fieldType === "SIGNATURE" || field.fieldType === "INITIALS";
      signatures.push({
        page: field.pageNumber ? field.pageNumber - 1 : 0,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        fieldType: field.fieldType as SignatureData["fieldType"],
        imageData: isImage ? (field.value ?? undefined) : undefined,
        value: isImage ? undefined : (field.value ?? undefined),
        signerName: signer.name,
        signedAt: signer.signedAt || new Date(),
      });
    }
  }

  if (signatures.length === 0) {
    throw new Error("Cannot finalize: no signed fields found for this document");
  }

  const signedFilename = generateSignedFilename(document.originalFileName);
  const signedPdf = await createSignedPdfBuffer(originalPdf, signatures);
  const storageKey = await uploadFile(signedPdf, signedFilename, "documents");
  const documentHash = hashBuffer(signedPdf);

  const completedAt = new Date();
  await prisma.document.update({
    where: { id: document.id },
    data: {
      status: "COMPLETED",
      completedAt,
      signedAt: completedAt,
      signedDocumentPath: storageKey,
      documentHash,
    },
  });

  // Pipeline contracts: tell the CRM. Same ref as the signing route's "completed" event, so a
  // finalize retry after a failed finalization is delivered once and a regeneration is a no-op.
  await enqueueContractEventSafe({
    documentId: document.id,
    dealRef: document.dealRef,
    event: "completed",
    completedAt,
  });


  return { signedPdf, signedFilename, storageKey, documentHash };
}
