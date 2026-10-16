import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import path from "path";
import { createSignedPdfBuffer, generateSignedFilename } from "@/lib/pdf-signer";
import { generateCertificate, hashBuffer } from "@/lib/document-hash";
import { getFileBuffer, uploadFile } from "@/lib/storage";
import { sendEmail } from "@/lib/email";
import {
  renderNextSignerNotification,
  renderDocumentCompletion,
} from "@/lib/email-templates";
import { enqueueContractEventSafe, signerRoleForOrder } from "@/lib/contract-events";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token } = body;

    console.log('[Complete] Completing signature for token:', token);

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Find the signer by token
    const signer = await prisma.documentSigner.findUnique({
      where: { token },
      include: {
        document: {
          include: {
            fields: true,
            signers: true,
          }
        }
      }
    });

    if (!signer) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 });
    }

    // Check if already completed - prevent race condition
    if (signer.status === 'COMPLETED') {
      return NextResponse.json({
        error: 'You have already signed this document',
        code: 'ALREADY_SIGNED',
        signer: {
          id: signer.id,
          status: signer.status,
          signedAt: signer.signedAt
        }
      }, { status: 409 }); // 409 Conflict
    }

    // Verify all required fields for this signer are completed
    const myFields = signer.document.fields.filter(
      (f: any) => f.assignedToId === signer.id
    );
    const requiredFields = myFields.filter((f: any) => f.required);
    const incompletedRequired = requiredFields.filter((f: any) => !f.value);

    if (incompletedRequired.length > 0) {
      return NextResponse.json(
        {
          error: 'Not all required fields are completed',
          missingFields: incompletedRequired.length
        },
        { status: 400 }
      );
    }

    // Update signer status to COMPLETED with race condition protection
    // Use transaction to ensure atomicity
    let updatedSigner;
    try {
      updatedSigner = await prisma.documentSigner.update({
        where: {
          id: signer.id,
          status: 'PENDING', // Only update if still PENDING
        },
        data: {
          status: 'COMPLETED',
          signedAt: new Date(),
        }
      });
    } catch (err: any) {
      // If update fails, it means status was already changed (race condition)
      if (err.code === 'P2025') {
        return NextResponse.json({
          error: 'You have already signed this document',
          code: 'ALREADY_SIGNED',
        }, { status: 409 });
      }
      throw err;
    }

    console.log('[Complete] Signer marked as completed:', updatedSigner.id);

    // Pipeline contracts (dealRef set) tell the CRM each signature as it happens. Outbox-backed and
    // non-throwing: an event problem never blocks a signature. No-op for every other document.
    await enqueueContractEventSafe({
      documentId: signer.document.id,
      dealRef: signer.document.dealRef,
      event: 'signer_signed',
      signerId: signer.id,
      signerEmail: signer.email,
      signerRole: signerRoleForOrder(signer.order),
    });

    // Check signing order
    const document = signer.document;
    const isSequential = document.signingOrder === 'SEQUENTIAL';

    // Check if all signers have completed
    const allSigners = signer.document.signers;
    const allCompleted = allSigners.every(
      (s: any) => s.id === signer.id || s.status === 'COMPLETED'
    );

    // Set if the signed PDF could not be produced. The signature is still saved, but the document
    // is NOT completed — we report that honestly rather than pretending.
    let finalizationError: string | null = null;

    // If sequential signing, notify next signer
    if (isSequential && !allCompleted) {
      console.log('[Complete] Sequential signing - checking for next signer...');

      // Find the next signer in sequence
      const sortedSigners = allSigners.sort((a: any, b: any) => a.order - b.order);
      const currentSignerOrder = signer.order;
      const nextSigner = sortedSigners.find(
        (s: any) => s.order > currentSignerOrder && s.status === 'PENDING'
      );

      if (nextSigner) {
        console.log(`[Complete] Sending invitation to next signer: ${nextSigner.email} (order ${nextSigner.order})`);

        // Send email to next signer using professional template
        try {
          const signLink = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/sign/${nextSigner.token}`;
          
          const emailHtml = renderNextSignerNotification({
            signerName: nextSigner.name || nextSigner.email,
            documentTitle: document.title,
            previousSignerName: signer.name || signer.email,
            signLink,
            signingOrder: nextSigner.order,
            totalSigners: allSigners.length,
          });

          await sendEmail(
            nextSigner.email,
            `Your Turn to Sign – ${document.title}`,
            emailHtml,
          );
          console.log(`[Complete] ✓ Email sent to next signer: ${nextSigner.email}`);
        } catch (emailErr) {
          console.error(`[Complete] Failed to send email to next signer ${nextSigner.email}:`, emailErr);
        }
      }
    }

    // If all signers completed, finalize the document
    if (allCompleted) {
      console.log('[Complete] All signers completed - generating final signed PDF...');

      try {
        // 1. Read the original PDF THROUGH THE STORAGE LAYER.
        // This previously guessed `<cwd>/uploads/documents/<basename>`, but uploads are written via
        // getStorageDir()/LOCAL_STORAGE_PATH (and may live in S3). The guess missed, the read threw,
        // and the catch below still marked the document COMPLETED — so documents were "signed" with
        // no signed PDF, no hash, and no certificate. Go through storage so every mode works.
        const originalPdf = await getFileBuffer(
          signer.document.cloudStoragePath,
          signer.document.cloudProvider
        );

        // Collect all filled fields from all signers
        const signatures = [];
        for (const s of allSigners) {
          // Find all fields for this signer that have values
          const signerFields = signer.document.fields.filter(
            (f: any) => f.assignedToId === s.id && f.value
          );

          // Add each filled field to the signatures array
          for (const field of signerFields) {
            signatures.push({
              page: field.pageNumber ? field.pageNumber - 1 : 0,
              x: field.x,
              y: field.y,
              width: field.width,
              height: field.height,
              fieldType: field.fieldType,
              imageData: (field.fieldType === 'SIGNATURE' || field.fieldType === 'INITIALS')
                ? (field.value ?? undefined)
                : undefined,
              value: (field.fieldType !== 'SIGNATURE' && field.fieldType !== 'INITIALS')
                ? (field.value ?? undefined)
                : undefined,
              signerName: s.name,
              signedAt: s.signedAt || new Date(),
            });
          }
        }

        // Stamp the signatures in memory, then persist through storage (honours STORAGE_MODE).
        const signedFilename = generateSignedFilename(signer.document.originalFileName);
        const signedPdf = await createSignedPdfBuffer(originalPdf, signatures);
        const signedStorageKey = await uploadFile(signedPdf, signedFilename, 'documents');
        console.log('[Complete] ✓ Signed PDF created:', signedStorageKey);

        // 2. Hash the bytes we actually produced (not a path that may not exist locally)
        const documentHash = hashBuffer(signedPdf);
        console.log('[Complete] ✓ Document hash:', documentHash.substring(0, 16) + '...');

        // 3. Update document with signed version and hash
        const completedAt = new Date();
        await prisma.document.update({
          where: { id: signer.document.id },
          data: {
            status: 'COMPLETED',
            completedAt,
            signedAt: completedAt,
            signedDocumentPath: signedStorageKey,
            documentHash,
          }
        });

        // Only now — the signed PDF exists — is the contract "completed" for the CRM.
        await enqueueContractEventSafe({
          documentId: signer.document.id,
          dealRef: signer.document.dealRef,
          event: 'completed',
          completedAt,
        });

        // 4. Generate certificate
        const certificate = generateCertificate({
          documentTitle: signer.document.title,
          documentHash,
          signers: allSigners.map((s: any) => ({
            name: s.name,
            email: s.email,
            signedAt: s.signedAt || new Date(),
          })),
          completedAt: new Date(),
        });

        // 5. Send completion emails to all signers
        console.log('[Complete] Sending completion emails to all signers...');

        for (const s of allSigners) {
          try {
            const emailHtml = renderDocumentCompletion({
              recipientName: s.name || s.email,
              documentTitle: signer.document.title,
              signers: allSigners.map((signer: any) => ({
                name: signer.name,
                email: signer.email,
                signedAt: signer.signedAt || new Date(),
              })),
              documentHash,
              completedAt: new Date(),
            });

            await sendEmail({
              to: s.email,
              subject: `Document Signed: ${signer.document.title}`,
              html: emailHtml,
              attachments: [
                {
                  filename: signedFilename,
                  content: signedPdf,   // the bytes we just produced; no local path to miss
                },
                {
                  filename: 'Certificate_of_Completion.txt',
                  content: certificate,
                },
              ],
            });

            console.log('[Complete] ✓ Email sent to:', s.email);
          } catch (emailErr) {
            console.error(`[Complete] Failed to send email to ${s.email}:`, emailErr);
          }
        }

        console.log('[Complete] ✅ All completion tasks finished successfully');
      } catch (err) {
        // DO NOT mark the document COMPLETED here. It previously did, which meant a failed
        // finalization produced a document that claimed to be signed while having no signed PDF, no
        // hash and no certificate — worse than an honest failure, because nobody ever found out.
        // The signatures themselves are already persisted, so leaving the document un-finalized
        // keeps it retryable via POST /api/documents/[id]/finalize.
        const reason = err instanceof Error ? err.message : String(err);
        console.error('[Complete] ❌ Finalization FAILED (document left un-finalized):', err);

        await prisma.auditLog.create({
          data: {
            documentId: signer.document.id,
            documentSignerId: signer.id,
            action: 'DOCUMENT_UPDATED',
            details: `Finalization failed — signed PDF was not produced. Document remains un-finalized and can be retried. Reason: ${reason}`,
          },
        });

        finalizationError = reason;
      }
    }

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        documentId: signer.document.id,
        documentSignerId: signer.id,
        action: 'DOCUMENT_SIGNED',
        details: `${signer.name} (${signer.email}) signed the document`,
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Document signed successfully',
      signer: {
        id: updatedSigner.id,
        status: updatedSigner.status,
        signedAt: updatedSigner.signedAt
      },
      // Only true when the signed PDF actually exists. A finalization failure no longer masquerades
      // as a completed document.
      documentCompleted: allCompleted && !finalizationError,
      ...(finalizationError ? { finalizationError } : {}),
    });

  } catch (err: any) {
    console.error('[Complete] Error completing signature:', err);
    console.error('[Complete] Error details:', {
      name: err.name,
      message: err.message,
      code: err.code,
      meta: err.meta,
      stack: err.stack
    });

    // Check if this is a Prisma validation error
    if (err.message && err.message.includes('expected pattern')) {
      console.error('[Complete] Pattern validation error - likely temp ID issue');
      return NextResponse.json({
        error: 'Database validation error: Invalid field assignment detected. This may be due to temporary signer IDs not being remapped. Please contact support.',
        details: err.message,
        hint: 'Make sure the document was sent with valid signer invites before signing.'
      }, { status: 400 });
    }

    // Check for Prisma foreign key errors
    if (err.code === 'P2003') {
      console.error('[Complete] Foreign key constraint error');
      return NextResponse.json({
        error: 'Database constraint error: Invalid reference detected.',
        details: err.meta,
        hint: 'This may occur if signer data was not properly initialized.'
      }, { status: 400 });
    }

    return NextResponse.json({
      error: err?.message || 'Failed to complete signature',
      errorType: err.name,
      code: err.code
    }, { status: 500 });
  }
}
