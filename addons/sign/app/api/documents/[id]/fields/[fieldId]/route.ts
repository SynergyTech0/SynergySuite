import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// ✅ Update a single document field (e.g. assign signer, change label, etc.)
// Automatically records corrections when OCR-detected fields are adjusted
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; fieldId: string }>}
) {
  try {
    const { id: documentId, fieldId } = await context.params;
    const body = await req.json();
    const { assignedTo, assignedToId, label, fieldType, required, x, y, width, height, value } = body;

    // Handle both assignedTo and assignedToId for compatibility
    const signerAssignment = assignedToId !== undefined ? assignedToId : assignedTo;

    // Get current user for correction tracking
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?
      (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id : null;

    // Fetch existing field to check if it was OCR-detected
    const existingField = await prisma.documentField.findUnique({
      where: { id: fieldId },
    });

    if (!existingField) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    // Check if this is a position/type correction on an OCR-detected field
    const isOcrField = existingField.detectionMethod !== 'MANUAL';
    const isPositionChange = (x !== undefined && x !== existingField.x) ||
                             (y !== undefined && y !== existingField.y) ||
                             (width !== undefined && width !== existingField.width) ||
                             (height !== undefined && height !== existingField.height);
    const isTypeChange = fieldType !== undefined && fieldType !== existingField.fieldType;
    const isLabelChange = label !== undefined && label !== existingField.label;

    const needsCorrection = isOcrField && (isPositionChange || isTypeChange || isLabelChange);

    // If OCR field is being corrected, record the correction for ML training
    if (needsCorrection && existingField.originalX !== null) {
      await prisma.fieldCorrection.create({
        data: {
          fieldId: existingField.id,
          documentId: existingField.documentId,
          // Original OCR values
          originalFieldType: existingField.fieldType,
          originalLabel: existingField.label,
          originalX: existingField.originalX!,
          originalY: existingField.originalY!,
          originalWidth: existingField.originalWidth!,
          originalHeight: existingField.originalHeight!,
          ocrConfidence: existingField.confidence,
          ocrSourceText: existingField.ocrSourceText,
          // Corrected values (use new value if provided, else existing)
          correctedFieldType: fieldType || existingField.fieldType,
          correctedLabel: label || existingField.label,
          correctedX: x ?? existingField.x,
          correctedY: y ?? existingField.y,
          correctedWidth: width ?? existingField.width,
          correctedHeight: height ?? existingField.height,
          // Metadata
          correctedBy: userId,
        },
      });
      console.log(`📊 Recorded field correction for training: ${fieldId}`);
    }

    // Update the field
    const field = await prisma.documentField.update({
      where: { id: fieldId },
      data: {
        ...(signerAssignment !== undefined && { assignedToId: signerAssignment || null }),
        ...(label !== undefined && { label }),
        ...(fieldType !== undefined && { fieldType }),
        ...(required !== undefined && { required }),
        ...(x !== undefined && { x }),
        ...(y !== undefined && { y }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(value !== undefined && { value }),
      },
    });

    return NextResponse.json({
      success: true,
      field,
      correctionRecorded: needsCorrection,
    });
  } catch (error) {
    console.error('Error updating field:', error);
    return NextResponse.json({ error: 'Failed to update field' }, { status: 500 });
  }
}

// ✅ Delete a specific field
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; fieldId: string }>}
) {
  try {
    await prisma.documentField.delete({
      where: { id: ((await context.params).fieldId) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting field:', error);
    return NextResponse.json({ error: 'Failed to delete field' }, { status: 500 });
  }
}
