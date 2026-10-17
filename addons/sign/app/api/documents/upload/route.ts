import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getStorageDir } from "@/lib/storage";
import { scanPDFSecurity, getSecurityRecommendations } from "@/lib/pdf-security";
import FormData from "form-data";
import fetch from "node-fetch";

export const dynamic = "force-dynamic";

const INFERENCE_URL = process.env.INFERENCE_API_URL || "http://localhost:8000";

// ----------------------------------------
// Helper: Timeout wrapper for fetch calls
// ----------------------------------------
async function fetchWithTimeout(url: string, options: any, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ----------------------------------------
// GPU OCR (FastAPI) — Using form-data with node-fetch
// ----------------------------------------
async function runOCR(buffer: Buffer, filename: string) {
  const form = new FormData();
  form.append("file", buffer, {
    filename: filename,
    contentType: "application/pdf",
    knownLength: buffer.length,
  });

  const res = await fetchWithTimeout(`${INFERENCE_URL}/ocr`, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  }, 30000); // 30 second timeout

  if (!res.ok) {
    const errorText = await res.text();
    console.error("OCR Error Response:", errorText);
    throw new Error(`OCR Error: ${errorText}`);
  }

  return res.json(); // { text: "..." }
}

// ----------------------------------------
// GPU SUMMARY (phi-3 via FastAPI)
// ----------------------------------------
async function runSummary(content: string) {
  const res = await fetchWithTimeout(`${INFERENCE_URL}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }, 30000); // 30 second timeout

  if (!res.ok) {
    throw new Error(`Summary Error: ${await res.text()}`);
  }

  const data = await res.json();
  return data.response || data.text || "";
}

// ----------------------------------------
// Field Detection (FastAPI with improved detection)
// ----------------------------------------
async function runFieldDetection(buffer: Buffer, filename: string) {
  const form = new FormData();
  form.append("file", buffer, {
    filename: filename,
    contentType: "application/pdf",
    knownLength: buffer.length,
  });

  const res = await fetchWithTimeout(`${INFERENCE_URL}/detect-fields`, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  }, 60000); // 60 second timeout for field detection (more intensive)

  if (!res.ok) {
    const errorText = await res.text();
    console.warn("Field detection failed:", errorText);
    return [];
  }

  const data: any = await res.json();
  // Returns: { success: true, pages: [...], total_fields: N }

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

  console.log(`✓ FastAPI detected ${allFields.length} raw fields during upload`);

  // DPI conversion: Backend uses 200 DPI, PDF.js uses 72 DPI
  const DPI_SCALE = 200 / 72; // ≈ 2.78

  // PDF dimensions for bounds validation (standard letter size at 72 DPI)
  const PDF_WIDTH = 612;
  const PDF_HEIGHT = 792;

  // Helper: Non-Maximum Suppression (NMS)
  const applyNMS = (fields: any[], iouThreshold = 0.5): any[] => {
    if (fields.length === 0) return [];

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

  // Helper: Calculate IOU
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

  // Convert coordinates from 200 DPI to 72 DPI
  const fieldsConverted = allFields.map(field => ({
    ...field,
    x: (field.x || 0) / DPI_SCALE,
    y: (field.y || 0) / DPI_SCALE,
    width: (field.width || 100) / DPI_SCALE,
    height: (field.height || 30) / DPI_SCALE,
  }));

  // Bounds validation
  const fieldsInBounds = fieldsConverted.filter(field => {
    return field.x >= 0 &&
      field.y >= 0 &&
      field.x + field.width <= PDF_WIDTH * 1.1 &&
      field.y + field.height <= PDF_HEIGHT * 1.1;
  });

  // Size filtering
  const MIN_WIDTH = 10;
  const MIN_HEIGHT = 5;
  const fieldsFiltered = fieldsInBounds.filter(field => {
    return field.width >= MIN_WIDTH && field.height >= MIN_HEIGHT;
  });

  // NMS deduplication
  const fieldsDeduped = applyNMS(fieldsFiltered, 0.5);

  console.log(`✓ Upload field processing: ${allFields.length} raw → ${fieldsDeduped.length} final fields`);

  return fieldsDeduped;
}

// ----------------------------------------
// MAIN UPLOAD ROUTE
// ----------------------------------------
export async function POST(request: NextRequest) {
  try {
    // 1) AUTH
    let userId: string | null = null;
    const session = await getServerSession(authOptions);
    userId = session?.user?.id || null;


    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) PARSE FORM
    const form = await request.formData();
    const file = form.get("file") as File;
    const title = form.get("title") as string;
    const description = (form.get("description") as string) || null;

    if (!file || !title) {
      return NextResponse.json(
        { error: "Missing file or title" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 3) PDF SECURITY SCAN
    const disableSecurity = process.env.DISABLE_PDF_SECURITY_SCAN === 'true';

    if (file.type === "application/pdf" && !disableSecurity) {
      console.log(`📄 File info:`, {
        name: file.name,
        type: file.type,
        size: file.size,
        bufferSize: buffer.length
      });

      const scan = await scanPDFSecurity(buffer);

      // Log security scan results for debugging
      console.log(`🔒 PDF Security Scan Results:`);
      console.log(`  Safe: ${scan.safe}`);
      console.log(`  Threats: ${scan.threats.length > 0 ? scan.threats.join(', ') : 'None'}`);
      console.log(`  Warnings: ${scan.warnings.length > 0 ? scan.warnings.join(', ') : 'None'}`);

      if (!scan.safe) {
        console.error(`❌ PDF blocked due to security threats:`, scan.threats);
        return NextResponse.json(
          {
            error: "Document blocked due to security threats",
            threats: scan.threats,
            warnings: scan.warnings,
            recommendations: getSecurityRecommendations(scan),
            details: "Your PDF was blocked for security reasons. If this is a legitimate document, try re-uploading it or contact support.",
          },
          { status: 400 }
        );
      }

      // Log warnings but allow upload
      if (scan.warnings.length > 0) {
        console.warn(`⚠️  PDF has warnings (upload allowed):`, scan.warnings);
      }
    } else if (file.type === "application/pdf" && disableSecurity) {
      console.warn(`⚠️  PDF security scan DISABLED (DISABLE_PDF_SECURITY_SCAN=true)`);
    }

    // 4) LOCAL STORAGE
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uid = crypto.randomBytes(6).toString("hex");
    const filename = `${Date.now()}-${uid}-${sanitized}`;

    const key = path.join("documents", filename);
    const { path: localPath } = await getStorageDir(key, "LOCAL");

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, buffer);

    // 5) DB RECORD
    const doc = await prisma.document.create({
      data: {
        title,
        description,
        cloudStoragePath: key,
        originalFileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        senderId: userId,
        status: "DRAFT",
        cloudProvider: "LOCAL",
      },
    });

    // 6) OCR TEXT (GPU) - gracefully handle failures
    let text = "";
    try {
      const ocr = await runOCR(buffer, file.name);
      text = ocr.text || "";
    } catch (ocrError) {
      console.warn("OCR failed, continuing without OCR:", ocrError);
    }

    // 7) SUMMARY (Phi-3 GPU) - gracefully handle failures
    let summary = "";
    try {
      if (text) {
        summary = await runSummary(text);
      }
    } catch (summaryError) {
      console.warn("Summary generation failed, continuing without summary:", summaryError);
    }

    // 8) FIELD DETECTION - DISABLED (model not trained yet)
    // Users can manually add fields via the UI or use the OCR button
    // To re-enable, uncomment the code below:
    /*
    let fields: any[] = [];
    try {
      fields = await runFieldDetection(buffer, file.name);
    } catch (fieldError) {
      console.warn("Field detection failed, continuing without auto-detection:", fieldError);
    }

    // 9) CREATE DOCUMENT FIELDS IN DATABASE (bulk insert for efficiency)
    console.log(`Creating ${fields.length} fields in database...`);

    // Map FastAPI field types to Prisma FieldType enum
    const mapFieldType = (type: string): string => {
      const typeMap: Record<string, string> = {
        'SIGNATURE': 'SIGNATURE',
        'INITIALS': 'INITIALS',
        'DATE': 'DATE',
        'CHECKBOX': 'CHECKBOX',
        'DROPDOWN': 'DROPDOWN',
        'TEXT': 'TEXT',
        // Map other types to TEXT
        'NAME': 'TEXT',
        'EMAIL': 'TEXT',
        'PHONE': 'TEXT',
      };
      return typeMap[type] || 'TEXT';
    };

    // Use createMany for bulk insert (single DB call instead of N calls)
    if (fields.length > 0) {
      await prisma.documentField.createMany({
        data: fields.map((field) => ({
          documentId: doc.id,
          fieldType: mapFieldType(field.fieldType || "TEXT"),
          label: field.label || field.fieldType || "Unknown",
          required: field.required || false,
          pageNumber: field.pageNumber || 1,
          x: Math.round(field.x || 0),
          y: Math.round(field.y || 0),
          width: Math.round(field.width || 100),
          height: Math.round(field.height || 30),
          value: null,
          assignedToId: null,
        })),
      });
    }
    */
    const fields: any[] = []; // Empty - no auto-detection

    // 10) UPDATE DOC
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        aiSummary: summary,
        suggestedFields: fields,
        aiAnalyzedAt: new Date(),
      },
    });

    // DONE
    return NextResponse.json({
      success: true,
      document: { ...doc, ocr: text, summary, fields },
    });
  } catch (err) {
    console.error("UPLOAD FAILED:", err);
    return NextResponse.json(
      { error: "Upload failed", details: String(err) },
      { status: 500 }
    );
  }
}
