/**
 * OCR endpoint using FastAPI GPU detection
 * POST /api/documents/[id]/ocr
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FieldType } from "@prisma/client";
import path from "path";
import fs from "fs/promises";
import os from "os";
import FormData from "form-data";
import fetch from "node-fetch";

export const dynamic = "force-dynamic";

const INFERENCE_URL = process.env.INFERENCE_API_URL || "http://localhost:8000";

// Helper to resolve PDF path
async function resolvePdfPath(cloudStoragePath: string): Promise<string> {
  if (path.isAbsolute(cloudStoragePath)) {
    return cloudStoragePath;
  }

  const cwd = process.cwd();
  const homeDir = os.homedir();

  const candidates = [
    path.join(cwd, "uploads", "documents", path.basename(cloudStoragePath)),
    path.join(cwd, "documents", path.basename(cloudStoragePath)),
    path.join(homeDir, "ai_docusign_clone", "uploads", "documents", path.basename(cloudStoragePath)),
  ];

  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }

  throw new Error(`PDF not found`);
}

// Background OCR processing function using FastAPI
async function processOCRInBackground(
  documentId: string,
  pdfPath: string,
  userId: string
) {
  try {
    console.log(`📄 Background OCR processing started for ${documentId}`);

    // Read PDF file
    const pdfBuffer = await fs.readFile(pdfPath);
    const filename = path.basename(pdfPath);

    // Use form-data package for proper Node.js multipart upload
    const form = new FormData();
    form.append("file", pdfBuffer, {
      filename: filename,
      contentType: "application/pdf",
      knownLength: pdfBuffer.length,
    });

    // Call FastAPI for field detection
    const res = await fetch(`${INFERENCE_URL}/detect-fields`, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`FastAPI detection failed: ${await res.text()}`);
    }

    const data = await res.json();

    // Flatten all pages into single array
    const allFields = [];
    for (const page of (data.pages || [])) {
      for (const field of (page.fields || [])) {
        allFields.push({
          ...field,
          pageNumber: page.page,
        });
      }
    }

    console.log(`✓ FastAPI detected ${allFields.length} raw fields`);

    // DPI conversion: Backend uses 200 DPI, PDF.js uses 72 DPI
    const DPI_SCALE = 200 / 72; // ≈ 2.78

    // Get PDF dimensions for bounds validation
    // Standard letter size at 72 DPI: 612x792 points
    // We'll validate after conversion
    const PDF_WIDTH = 612;
    const PDF_HEIGHT = 792;

    // Helper: Non-Maximum Suppression (NMS) to remove duplicate/overlapping detections
    const applyNMS = (fields: any[], iouThreshold = 0.5): any[] => {
      if (fields.length === 0) return [];

      // Sort by confidence (if available) or area (larger first)
      const sorted = [...fields].sort((a, b) => {
        const confA = a.confidence || 0;
        const confB = b.confidence || 0;
        if (confA !== confB) return confB - confA; // Higher confidence first
        return (b.width * b.height) - (a.width * a.height); // Larger area first
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
    const fieldsWithConvertedCoords = allFields.map(field => ({
      ...field,
      x: (field.x || 0) / DPI_SCALE,
      y: (field.y || 0) / DPI_SCALE,
      width: (field.width || 100) / DPI_SCALE,
      height: (field.height || 30) / DPI_SCALE,
    }));

    console.log(`✓ Converted coordinates from 200 DPI to 72 DPI (PDF space)`);

    // Apply bounds validation - filter out fields outside document
    const fieldsInBounds = fieldsWithConvertedCoords.filter(field => {
      const isInBounds = field.x >= 0 &&
        field.y >= 0 &&
        field.x + field.width <= PDF_WIDTH * 1.1 && // Allow 10% margin for multi-size docs
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
    const MIN_CONFIDENCE = 0.3; // If confidence field exists

    const fieldsFiltered = fieldsInBounds.filter(field => {
      const sizeOk = field.width >= MIN_WIDTH && field.height >= MIN_HEIGHT;
      const confOk = !field.confidence || field.confidence >= MIN_CONFIDENCE;

      if (!sizeOk) {
        console.log(`⚠️  Filtered small field (${Math.round(field.width)}x${Math.round(field.height)})`);
      }

      return sizeOk && confOk;
    });

    console.log(`✓ Size/confidence filtering: ${fieldsFiltered.length}/${fieldsInBounds.length} fields passed`);

    // Apply NMS to remove duplicate/overlapping detections
    const fieldsDeduped = applyNMS(fieldsFiltered, 0.5);

    console.log(`✓ NMS deduplication: ${fieldsDeduped.length}/${fieldsFiltered.length} unique fields`);

    // Delete existing fields
    await prisma.documentField.deleteMany({
      where: { documentId },
    });

    // Map FastAPI field types to Prisma FieldType enum
    const mapFieldType = (type: string): FieldType => {
      const typeMap: Record<string, FieldType> = {
        'SIGNATURE': 'SIGNATURE',
        'INITIALS': 'INITIALS',
        'DATE': 'DATE',
        'CHECKBOX': 'CHECKBOX',
        'DROPDOWN': 'DROPDOWN',
        'TEXT': 'TEXT',
      };
      // Map NAME, EMAIL, PHONE, etc. to TEXT
      return typeMap[type] || 'TEXT';
    };

    // Create new fields with validated, converted coordinates
    // Include detection tracking for training data collection
    const createdFields = [];
    for (const field of fieldsDeduped) {
      const created = await prisma.documentField.create({
        data: {
          documentId,
          fieldType: mapFieldType(field.fieldType || "TEXT"),
          label: field.label || field.fieldType || "Unknown",
          required: field.required || false,
          pageNumber: field.pageNumber || 1,
          x: Math.round(field.x),
          y: Math.round(field.y),
          width: Math.round(field.width),
          height: Math.round(field.height),
          value: null,
          assignedToId: null,
          // Detection tracking for ML training
          detectionMethod: "OCR_GPU",
          confidence: field.confidence || null,
          ocrSourceText: field.ocrText || field.label || null,
          originalX: Math.round(field.x),
          originalY: Math.round(field.y),
          originalWidth: Math.round(field.width),
          originalHeight: Math.round(field.height),
        },
      });
      createdFields.push(created);
    }

    // Update document
    await prisma.document.update({
      where: { id: documentId },
      data: {
        aiDetectedAt: new Date(),
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        documentId,
        userId,
        action: "FIELD_ADDED",
        details: {
          source: "FASTAPI_GPU",
          fieldsDetected: createdFields.length,
          totalPages: data.pages?.length || 0,
        },
      },
    });

    console.log(`✅ Background OCR complete: ${createdFields.length} fields detected`);
  } catch (error: any) {
    console.error("❌ Background OCR error:", error);

    // Update document to indicate OCR failed
    await prisma.document.update({
      where: { id: documentId },
      data: {
        summary: `OCR processing failed: ${error.message}`,
      },
    });
  }
}

/**
 * GET /api/documents/[id]/ocr
 * Check OCR processing status
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: documentId } = await context.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        fields: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const hasFields = document.fields.length > 0;
    const isProcessed = !!document.aiDetectedAt;

    return NextResponse.json({
      success: true,
      status: isProcessed ? "completed" : "processing",
      fieldsDetected: document.fields.length,
      aiDetectedAt: document.aiDetectedAt,
      hasFields,
    });
  } catch (error: any) {
    console.error("OCR status check error:", error);
    return NextResponse.json(
      { error: "Failed to check OCR status", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/[id]/ocr
 * Start OpenCV-enhanced OCR on document (async)
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: documentId } = await context.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (document.senderId !== user?.id && user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    console.log(`🔍 Starting async OpenCV OCR for document ${documentId}...`);

    // Resolve PDF path
    const pdfPath = await resolvePdfPath(document.cloudStoragePath);

    // Start OCR processing in background (don't await)
    processOCRInBackground(documentId, pdfPath, user!.id).catch((err) => {
      console.error(`Background OCR failed for ${documentId}:`, err);
    });

    // Return immediately
    return NextResponse.json({
      success: true,
      status: "processing",
      message: "OCR processing started. This may take 30-60 seconds.",
      documentId,
    });
  } catch (error: any) {
    console.error("OCR initialization error:", error);
    return NextResponse.json(
      { error: "Failed to start OCR processing", details: error.message },
      { status: 500 }
    );
  }
}
