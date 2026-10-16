import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import tesseract from "node-tesseract-ocr";
import { prisma } from "@/lib/db";
import { getStorageDir } from "@/lib/storage";

const execAsync = promisify(execFile);

export async function POST(req, { params }) {
  const tempImages = [];
  
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;
    
    console.log("🔍 Looking for document ID:", id);

    const document = await prisma.document.findUnique({
      where: { id },
      select: { 
        cloudStoragePath: true,
        cloudProvider: true,
        fileType: true
      }
    });

    console.log("📄 Document found:", document);

    if (!document) {
      return NextResponse.json({ error: "Document not found in database" }, { status: 404 });
    }

    if (document.fileType !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files can be processed for OCR" },
        { status: 400 }
      );
    }

    const { path: filePath } = await getStorageDir(
      document.cloudStoragePath,
      document.cloudProvider
    );

    console.log("📂 Resolved file path:", filePath);
    console.log("📂 File exists:", fsSync.existsSync(filePath));

    if (!fsSync.existsSync(filePath)) {
      return NextResponse.json(
        { error: `PDF file not found at: ${filePath}` },
        { status: 404 }
      );
    }

    console.log(`📄 Processing PDF: ${filePath}`);

    const pdfBytes = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    let allFields = [];

    const tempDir = path.join(process.cwd(), "uploads", "temp");
    await fs.mkdir(tempDir, { recursive: true });

    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
      const page = pages[pageNum];
      const { width: pdfWidth, height: pdfHeight } = page.getSize();

      const outputPrefix = path.join(tempDir, `${id}-page-${pageNum}`);
      
      console.log(`🔄 Converting page ${pageNum + 1} to PNG...`);
      
      await execAsync("pdftoppm", [
        "-png",
        "-f", `${pageNum + 1}`,
        "-l", `${pageNum + 1}`,
        "-singlefile",
        filePath,
        outputPrefix
      ]);

      const imageOut = `${outputPrefix}.png`;
      tempImages.push(imageOut);

      if (!fsSync.existsSync(imageOut)) {
        console.warn(`⚠️ Image not generated for page ${pageNum + 1}`);
        continue;
      }

      console.log(`🔍 Running OCR on page ${pageNum + 1}...`);

      try {
        const ocrResult = await tesseract.recognize(imageOut, {
          lang: "eng",
        });

        console.log(`✅ OCR completed for page ${pageNum + 1}`);

        const imageBytes = await fs.readFile(imageOut);
        const img = await pdfDoc.embedPng(imageBytes);
        
        const scaleX = pdfWidth / img.width;
        const scaleY = pdfHeight / img.height;

        const lines = ocrResult.split('\n').filter(line => line.trim());
        
        lines.forEach((text, idx) => {
          if (!text || text.trim() === "") return;

          const estimatedY = pdfHeight - (idx * 20 * scaleY + 50);
          
          allFields.push({
            documentId: id,
            fieldType: detectFieldType(text),
            label: text.slice(0, 100),
            pageNumber: pageNum + 1,
            x: 50,
            y: Math.max(0, estimatedY),
            width: 200,
            height: 20,
            required: true,
            assignedToId: null,
          });
        });

      } catch (ocrError) {
        console.error(`❌ OCR failed for page ${pageNum + 1}:`, ocrError);
      }
    }

    console.log(`📊 Found ${allFields.length} fields across ${pages.length} pages`);

    await prisma.documentField.deleteMany({
      where: { documentId: id },
    });

    if (allFields.length > 0) {
      await prisma.documentField.createMany({
        data: allFields,
      });
    }

    return NextResponse.json({
      success: true,
      count: allFields.length,
      pages: pages.length,
      fields: allFields,
    });

  } catch (err) {
    console.error("❌ OCR ERROR:", err);
    return NextResponse.json(
      { error: err.message || "OCR failed" },
      { status: 500 }
    );
  } finally {
    for (const imgPath of tempImages) {
      try {
        await fs.unlink(imgPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

function detectFieldType(text) {
  const t = text.toLowerCase();
  if (t.includes("sign")) return "SIGNATURE";
  if (t.includes("initial")) return "INITIALS";
  if (t.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) return "DATE";
  if (t.includes("checkbox") || t.includes("[ ]") || t.includes("☐")) return "CHECKBOX";
  return "TEXT";
}
