import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Utility endpoint to fix field assignments with temp IDs
 * This endpoint finds all fields with temp-X IDs and attempts to remap them
 * to real DocumentSigner IDs based on document and email matching
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find all fields with temp-X assignment IDs
    const fieldsWithTempIds = await prisma.documentField.findMany({
      where: {
        assignedToId: {
          startsWith: 'temp-',
        },
      },
      include: {
        document: {
          include: {
            signers: true,
          },
        },
      },
    });

    console.log(`[Fix Assignments] Found ${fieldsWithTempIds.length} fields with temp IDs`);

    let fixedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    for (const field of fieldsWithTempIds) {
      const tempIndex = parseInt(field.assignedToId!.replace('temp-', ''));
      console.log(`[Fix Assignments] Processing field ${field.id} (temp-${tempIndex}) in document ${field.documentId}`);

      // Get all signers for this document
      const signers = field.document.signers;

      if (signers.length === 0) {
        console.log(`[Fix Assignments] No signers found for document ${field.documentId}`);
        skippedCount++;
        results.push({
          fieldId: field.id,
          documentId: field.documentId,
          status: 'skipped',
          reason: 'No signers found for document',
        });
        continue;
      }

      // Try to match by index first (if we have that many signers)
      let matchedSigner = signers[tempIndex];

      // If no match by index, try to match by any signer (for single-signer docs)
      if (!matchedSigner && signers.length === 1) {
        matchedSigner = signers[0];
        console.log(`[Fix Assignments] Single signer document - assigning to ${matchedSigner.email}`);
      }

      if (matchedSigner) {
        try {
          await prisma.documentField.update({
            where: { id: field.id },
            data: { assignedToId: matchedSigner.id },
          });

          fixedCount++;
          console.log(`[Fix Assignments] ✓ Fixed field ${field.id}: temp-${tempIndex} → ${matchedSigner.id} (${matchedSigner.email})`);

          results.push({
            fieldId: field.id,
            documentId: field.documentId,
            status: 'fixed',
            oldValue: `temp-${tempIndex}`,
            newValue: matchedSigner.id,
            signerEmail: matchedSigner.email,
          });
        } catch (error) {
          failedCount++;
          console.error(`[Fix Assignments] ✗ Failed to update field ${field.id}:`, error);

          results.push({
            fieldId: field.id,
            documentId: field.documentId,
            status: 'failed',
            error: String(error),
          });
        }
      } else {
        failedCount++;
        console.log(`[Fix Assignments] ✗ Could not find matching signer for field ${field.id} (temp-${tempIndex})`);

        results.push({
          fieldId: field.id,
          documentId: field.documentId,
          status: 'failed',
          reason: `No signer at index ${tempIndex} (document has ${signers.length} signer(s))`,
        });
      }
    }

    console.log(`[Fix Assignments] Complete: ${fixedCount} fixed, ${failedCount} failed, ${skippedCount} skipped`);

    return NextResponse.json({
      success: true,
      summary: {
        total: fieldsWithTempIds.length,
        fixed: fixedCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      results,
    });
  } catch (error) {
    console.error('[Fix Assignments] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fix field assignments', details: String(error) },
      { status: 500 }
    );
  }
}
