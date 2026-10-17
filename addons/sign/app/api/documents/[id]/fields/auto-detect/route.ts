import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FieldType, Prisma } from "@prisma/client";
import {
  convertPdfToImages,
  runOcrOnImage,
  detectFieldsFromOcr,
  summarizeText,
} from "@/lib/ocr-utils";
import { documentForOwner, isDenied } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }>}
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const documentId = ((await context.params).id);
    const __owner = await documentForOwner(documentId);
    if (isDenied(__owner)) return __owner.denied;

    // Fetch document with signers
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        sender: true,
        signers: true, // Include signers for auto-assignment
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Ensure only sender or admin can auto-detect
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (document.senderId !== user?.id && user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Convert PDF → images
    console.log(`🔍 Converting PDF to images for document ${documentId}...`);
    let images;
    try {
      images = await convertPdfToImages(document.cloudStoragePath);
    } catch (error) {
      console.error("PDF conversion failed:", error);
      return NextResponse.json(
        { error: "Failed to process PDF file" },
        { status: 500 }
      );
    }

    if (!images || images.length === 0) {
      return NextResponse.json(
        { error: "No pages extracted from PDF" },
        { status: 400 }
      );
    }

    // 🎯 Build party-to-signer mapping for auto-assignment
    const partyToSignerMap: Record<string, string> = {};
    for (const signer of document.signers) {
      const signerName = signer.name.toLowerCase();
      // Match "Employee", "Employer", etc. to signer names
      if (/employee|worker|staff/i.test(signerName)) {
        partyToSignerMap["Employee"] = signer.id;
      } else if (/employer|company|organization|business/i.test(signerName)) {
        partyToSignerMap["Employer"] = signer.id;
      }
      // You can add more mappings here (e.g., "Contractor", "Witness", etc.)
    }

    console.log(`🎯 Party-to-Signer mapping:`, partyToSignerMap);

    // DPI conversion: Backend uses 200 DPI, PDF.js uses 72 DPI
    const DPI_SCALE = 200 / 72; // ≈ 2.78

    // PDF dimensions for bounds validation (standard letter size at 72 DPI)
    const PDF_WIDTH = 612;
    const PDF_HEIGHT = 792;

    let fullText = "";
    const fieldsRaw: any[] = [];

    // OCR each page & detect fields
    console.log(`📄 Processing ${images.length} pages...`);
    for (const { pageNumber, imagePath } of images) {
      try {
        const ocrBlocks = await runOcrOnImage(imagePath);
        const detectedFields = detectFieldsFromOcr(ocrBlocks);

        // Collect raw fields with page info and party suggestions
        for (const field of detectedFields) {
          fieldsRaw.push({
            ...field,
            pageNumber,
          });
        }

        // Accumulate text for summary
        fullText += ocrBlocks.map((b: any) => b.text).join(" ") + "\n";
      } catch (pageError) {
        console.error(`Error processing page ${pageNumber}:`, pageError);
        // Continue with other pages
      }
    }

    console.log(`✓ Detected ${fieldsRaw.length} raw fields across ${images.length} pages`);

    // Helper: Non-Maximum Suppression (NMS) to remove duplicate/overlapping detections
    const applyNMS = (fields: any[], iouThreshold = 0.5): any[] => {
      if (fields.length === 0) return [];

      // Sort by confidence (if available) or area (larger first)
      const sorted = [...fields].sort((a, b) => {
        const confA = a.confidence || 0;
        const confB = b.confidence || 0;
        if (confA !== confB) return confB - confA;
        return (b.width * b.height) - (a.width * a.height);
      });

      const keep: any[] = [];
      const suppressed = new Set<number>();

      for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue;

        const boxA = sorted[i];
        keep.push(boxA);

        // Suppress overlapping boxes
        for (let j = i + 1; j < sorted.length; j++) {
          if (suppressed.has(j)) continue;

          const boxB = sorted[j];
          const iou = calculateIOU(boxA, boxB);

          if (iou > iouThreshold) {
            suppressed.add(j);
          }
        }
      }

      return keep;
    };

    // Helper: Calculate Intersection over Union (IOU)
    const calculateIOU = (boxA: any, boxB: any): number => {
      const x1 = Math.max(boxA.x, boxB.x);
      const y1 = Math.max(boxA.y, boxB.y);
      const x2 = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
      const y2 = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

      const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const areaA = boxA.width * boxA.height;
      const areaB = boxB.width * boxB.height;
      const union = areaA + areaB - intersection;

      return union > 0 ? intersection / union : 0;
    };

    // Convert coordinates from 200 DPI to 72 DPI (PDF space)
    const fieldsWithConvertedCoords = fieldsRaw.map(field => ({
      ...field,
      x: field.x / DPI_SCALE,
      y: field.y / DPI_SCALE,
      width: field.width / DPI_SCALE,
      height: field.height / DPI_SCALE,
    }));

    console.log(`✓ Converted coordinates from 200 DPI to 72 DPI (PDF space)`);

    // Apply bounds validation - filter out fields outside document
    const fieldsInBounds = fieldsWithConvertedCoords.filter(field => {
      const isInBounds = field.x >= 0 &&
        field.y >= 0 &&
        field.x + field.width <= PDF_WIDTH * 1.1 &&
        field.y + field.height <= PDF_HEIGHT * 1.1;

      if (!isInBounds) {
        console.log(`⚠️  Filtered out-of-bounds field at (${Math.round(field.x)}, ${Math.round(field.y)})`);
      }

      return isInBounds;
    });

    console.log(`✓ Bounds validation: ${fieldsInBounds.length}/${fieldsWithConvertedCoords.length} fields within document`);

    // Apply confidence/size filtering
    const MIN_WIDTH = 10;
    const MIN_HEIGHT = 5;

    const fieldsFiltered = fieldsInBounds.filter(field => {
      const sizeOk = field.width >= MIN_WIDTH && field.height >= MIN_HEIGHT;

      if (!sizeOk) {
        console.log(`⚠️  Filtered small field (${Math.round(field.width)}x${Math.round(field.height)})`);
      }

      return sizeOk;
    });

    console.log(`✓ Size filtering: ${fieldsFiltered.length}/${fieldsInBounds.length} fields passed`);

    // Apply NMS to remove duplicate/overlapping detections
    const fieldsDeduped = applyNMS(fieldsFiltered, 0.5);

    console.log(`✓ NMS deduplication: ${fieldsDeduped.length}/${fieldsFiltered.length} unique fields`);

    // Build final fields to create with auto-assignment
    const fieldsToCreate: Prisma.DocumentFieldCreateInput[] = [];

    for (const field of fieldsDeduped) {
      // 🎯 Auto-assign field to signer based on suggestedParty
      let assignedToId: string | null = null;
      if (field.suggestedParty && partyToSignerMap[field.suggestedParty]) {
        assignedToId = partyToSignerMap[field.suggestedParty];
        console.log(`✅ Auto-assigning "${field.label}" to ${field.suggestedParty} (${assignedToId})`);
      }

      fieldsToCreate.push({
        document: { connect: { id: document.id } },
        fieldType: field.fieldType as FieldType,
        label: field.label,
        required: field.required ?? true,
        pageNumber: field.pageNumber,
        x: Math.round(field.x),
        y: Math.round(field.y),
        width: Math.round(field.width),
        height: Math.round(field.height),
        value: null,
        options: {},
        // Detection tracking for ML training
        detectionMethod: "OCR_LOCAL",
        confidence: field.confidence || null,
        ocrSourceText: field.ocrText || field.label || null,
        originalX: Math.round(field.x),
        originalY: Math.round(field.y),
        originalWidth: Math.round(field.width),
        originalHeight: Math.round(field.height),
        // 🎯 AUTO-ASSIGN to party/signer
        assignedToId,
      });
    }

    // Delete existing auto-detected fields (unassigned ones)
    await prisma.documentField.deleteMany({
      where: {
        documentId,
        assignedToId: null, // ✅ Fixed from assignedTo: ""
      },
    });

    // Generate summary
    console.log(`📝 Generating summary...`);
    let summary = "";
    try {
      summary = await summarizeText(fullText.trim(), 600);
    } catch (summaryError) {
      console.error("Summary generation failed:", summaryError);
      summary = fullText.substring(0, 500) + "...";
    }

    // Create fields and update document in transaction
    const operations: Prisma.PrismaPromise<any>[] = [];

    // Add document update with summary
    operations.push(
      prisma.document.update({
        where: { id: documentId },
        data: { summary },
      })
    );

    // Add field creation operations
    for (const fieldData of fieldsToCreate) {
      operations.push(prisma.documentField.create({ data: fieldData }));
    }

    await prisma.$transaction(operations);

    // Create audit log
    await prisma.auditLog.create({
      data: {
        documentId,
        userId: user!.id,
        action: "FIELD_ADDED",
        details: {
          fieldsDetected: fieldsToCreate.length,
          pagesProcessed: images.length,
        },
      },
    });

    // Count auto-assigned fields
    const autoAssignedCount = fieldsToCreate.filter(f => f.assignedToId).length;

    console.log(
      `✅ Auto-detected ${fieldsToCreate.length} fields across ${images.length} pages (${autoAssignedCount} auto-assigned to parties)`
    );

    return NextResponse.json({
      success: true,
      message: `Detected ${fieldsToCreate.length} fields and generated summary. ${autoAssignedCount} fields auto-assigned to parties.`,
      fieldsDetected: fieldsToCreate.length,
      fieldsAutoAssigned: autoAssignedCount,
      pagesProcessed: images.length,
      partyMappings: partyToSignerMap,
      summary,
    });
  } catch (error) {
    console.error("Auto-detect failed:", error);
    return NextResponse.json(
      {
        error: "Failed to auto-detect fields",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
