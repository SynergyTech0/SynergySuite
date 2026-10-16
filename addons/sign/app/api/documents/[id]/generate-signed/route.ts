import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// Resolve the PDF file path
async function resolvePdfPath(cloudStoragePath: string): Promise<string> {
  const cwd = process.cwd();

  const candidates = [
    cloudStoragePath,
    path.join(cwd, "uploads", cloudStoragePath),
    path.join(cwd, "uploads", "documents", path.basename(cloudStoragePath)),
    path.join(cwd, "uploads", path.basename(cloudStoragePath)),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(`PDF not found: ${cloudStoragePath}`);
}

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

    // Fetch document with fields
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        fields: true,
        signers: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Resolve PDF path
    const pdfPath = await resolvePdfPath(document.cloudStoragePath);
    const pdfBytes = await fs.readFile(pdfPath);

    // Load PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Process each field
    for (const field of document.fields) {
      if (!field.value) continue;

      const pageIndex = (field.pageNumber || 1) - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();

      // Convert coordinates (our y is from top, PDF y is from bottom)
      const pdfX = field.x;
      const pdfY = pageHeight - field.y - field.height;

      if (field.fieldType === "SIGNATURE" || field.fieldType === "INITIALS") {
        // Handle signature/initials as image
        if (field.value.startsWith("data:image/png")) {
          try {
            const base64Data = field.value.replace(/^data:image\/png;base64,/, "");
            const imageBytes = Buffer.from(base64Data, "base64");
            const signatureImage = await pdfDoc.embedPng(imageBytes);

            // Scale image to fit field
            const scaledDims = signatureImage.scaleToFit(field.width, field.height);

            page.drawImage(signatureImage, {
              x: pdfX,
              y: pdfY,
              width: scaledDims.width,
              height: scaledDims.height,
            });
          } catch (imgErr) {
            console.error("Failed to embed signature image:", imgErr);
          }
        }
      } else if (field.fieldType === "CHECKBOX") {
        // Draw checkmark for checkbox
        if (field.value === "checked") {
          page.drawText("✓", {
            x: pdfX + 2,
            y: pdfY + 2,
            size: Math.min(field.width, field.height) * 0.8,
            font,
            color: rgb(0, 0.5, 0),
          });
        }
      } else if (field.fieldType === "DATE" || field.fieldType === "TEXT") {
        // Draw text
        const fontSize = Math.min(12, field.height * 0.6);
        page.drawText(field.value, {
          x: pdfX + 2,
          y: pdfY + (field.height - fontSize) / 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }

    // Save the modified PDF
    const modifiedPdfBytes = await pdfDoc.save();

    // Save to uploads/signed folder
    const signedFileName = `signed-${Date.now()}-${path.basename(pdfPath)}`;
    const signedPath = path.join(process.cwd(), "uploads", "signed", signedFileName);

    await fs.mkdir(path.dirname(signedPath), { recursive: true });
    await fs.writeFile(signedPath, modifiedPdfBytes);

    // Update document status
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        documentId,
        userId: session.user.id as string,
        action: "DOCUMENT_COMPLETED",
        details: {
          signedFilePath: `signed/${signedFileName}`,
          fieldsCompleted: document.fields.filter((f) => f.value).length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      signedPdfPath: `signed/${signedFileName}`,
      downloadUrl: `/api/files/signed/${signedFileName}`,
    });
  } catch (error) {
    console.error("Generate signed PDF error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate signed PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
