import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FieldType, Prisma } from "@prisma/client";
import Tesseract from "tesseract.js";
import { getFileFromStorage } from "@/lib/storage";
import { getSummary } from "@/lib/ocr-utils";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ✅ FIX: resolve params properly
    const { documentId } = await context.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { sender: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.senderId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ✅ Retrieve file
    let buffer: Buffer;
    try {
      buffer = await getFileFromStorage(document.cloudStoragePath);
    } catch (error) {
      console.error("Failed to fetch document from storage:", error);
      return NextResponse.json(
        { error: "Failed to retrieve document" },
        { status: 500 }
      );
    }

    // ✅ OCR processing
    console.log(`🔍 Running OCR for document ${documentId}...`);
    const ocrResult = await Tesseract.recognize(buffer, "eng", {
      logger: (m) => console.log(m),
    });

    const text = ocrResult.data.text || "";
    let summary = document.summary;

    if (!summary && text.length > 0) {
      try {
        summary = await getSummary(text);
      } catch (error) {
        console.error("Summary generation failed:", error);
        summary = text.substring(0, 500) + "...";
      }
    }

    // ✅ Detect fields
    const suggestedFields = detectFields(text, ocrResult.data);

    // Delete old unassigned fields
    await prisma.documentField.deleteMany({
      where: { documentId, assignedToId: null },
    });

    // ✅ Create new fields + update summary in one transaction
    const operations: Prisma.PrismaPromise<any>[] = suggestedFields.map((field) =>
      prisma.documentField.create({
        data: {
          documentId,
          fieldType: field.fieldType,
          label: field.label,
          assignedToId: null,
          pageNumber: field.pageNumber,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          value: null,
        },
      })
    );

    if (summary && summary !== document.summary) {
      operations.unshift(
        prisma.document.update({
          where: { id: documentId },
          data: { summary },
        })
      );
    }

    const createdFields = await prisma.$transaction(operations);

    try {
      await prisma.auditLog.create({
        data: {
          documentId,
          userId: session.user.id,
          action: "FIELDS_AUTO_DETECTED" as any,
          details: { fieldsCount: suggestedFields.length },
        },
      });
    } catch (e) {
      console.warn("⚠️ Audit log failed:", e);
    }

    console.log(`✅ Auto-detected ${suggestedFields.length} fields for ${documentId}`);

    return NextResponse.json({
      success: true,
      fieldsDetected: suggestedFields.length,
      summary,
      fields: createdFields.filter((f: any) => f?.fieldType),
    });
  } catch (error) {
    console.error("❌ Auto-detect fields error:", error);
    return NextResponse.json(
      {
        error: "Failed to auto-detect fields",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ==========================================================
// Simple heuristic for detecting signature/date fields
// ==========================================================

interface DetectedField {
  fieldType: FieldType;
  label: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
}

function detectFields(text: string, ocrData: any): DetectedField[] {
  const fields: DetectedField[] = [];
  const lowerText = text.toLowerCase();

  const signatureKeywords = [
    "signature",
    "sign here",
    "signed by",
    "authorized signature",
    "signatory",
    "sign:",
    "signed:",
    "_________",
  ];

  const dateKeywords = [
    "date",
    "dated",
    "date:",
    "dated:",
    "date signed",
    "effective date",
  ];

  signatureKeywords.forEach((keyword) => {
    const index = lowerText.indexOf(keyword);
    if (index !== -1) {
      fields.push({
        fieldType: FieldType.SIGNATURE,
        label: "Signature",
        pageNumber: 1,
        x: 100,
        y:
          600 +
          fields.filter((f) => f.fieldType === FieldType.SIGNATURE).length * 100,
        width: 200,
        height: 50,
      });
    }
  });

  dateKeywords.forEach((keyword) => {
    const index = lowerText.indexOf(keyword);
    if (index !== -1) {
      fields.push({
        fieldType: FieldType.DATE,
        label: "Date",
        pageNumber: 1,
        x: 350,
        y:
          600 +
          fields.filter((f) => f.fieldType === FieldType.DATE).length * 100,
        width: 150,
        height: 40,
      });
    }
  });

  if (fields.length === 0) {
    fields.push(
      {
        fieldType: FieldType.SIGNATURE,
        label: "Signature",
        pageNumber: 1,
        x: 100,
        y: 600,
        width: 200,
        height: 50,
      },
      {
        fieldType: FieldType.DATE,
        label: "Date",
        pageNumber: 1,
        x: 350,
        y: 600,
        width: 150,
        height: 40,
      }
    );
  }

  return fields;
}
