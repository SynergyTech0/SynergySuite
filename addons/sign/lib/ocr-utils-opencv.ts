/**
 * Enhanced OCR with OpenCV preprocessing
 * Replaces the basic Tesseract-only approach
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { preprocessImage, detectFormBoxes, DetectedBox } from "./opencv-wrapper";

const exec = promisify(execFile);

const OCR_TEMP_DIR = "/tmp/ocr_pages";
const OCR_LANG = "eng";

async function ensureTempDir() {
  await fs.mkdir(OCR_TEMP_DIR, { recursive: true });
}

// ====================================
// PDF to Images (same as before)
// ====================================
export async function convertPdfToImages(pdfPath: string): Promise<{ pageNumber: number; imagePath: string }[]> {
  await ensureTempDir();
  const outputPrefix = path.join(OCR_TEMP_DIR, `page_${Date.now()}`);

  let resolvedPdfPath = pdfPath;
  if (!path.isAbsolute(pdfPath)) {
    const cwd = process.cwd();
    const homeDir = os.homedir();

    const candidates = [
      path.join(cwd, "uploads", "documents", path.basename(pdfPath)),
      path.join(cwd, "documents", path.basename(pdfPath)),
      path.join(homeDir, "ai_docusign_clone", "uploads", "documents", path.basename(pdfPath))
    ];

    for (const p of candidates) {
      try {
        await fs.access(p);
        resolvedPdfPath = p;
        break;
      } catch {}
    }

    if (!resolvedPdfPath || resolvedPdfPath === pdfPath) {
      throw new Error(`❌ PDF not found at any expected path: ${candidates.join(", ")}`);
    }
  }

  try {
    // Reduced DPI from 200 to 150 for faster processing (25% speed improvement)
    await exec("pdftoppm", ["-png", "-r", "150", resolvedPdfPath, outputPrefix]);
  } catch (err) {
    console.warn("pdftoppm not found, trying ImageMagick convert");
    await exec("convert", ["-density", "150", resolvedPdfPath, `${outputPrefix}-%03d.png`]);
  }

  const files = await fs.readdir(OCR_TEMP_DIR);
  const images = files
    .filter((f) => f.startsWith(path.basename(outputPrefix)))
    .map((f) => {
      // Extract page number from filename like: page_1764265467262-1.png
      // The page number is after the last dash, not the first number (which is timestamp)
      const match = f.match(/-(\d+)\.png$/);
      const pageNumber = match ? parseInt(match[1], 10) : 1;
      return {
        pageNumber,
        imagePath: path.join(OCR_TEMP_DIR, f),
      };
    });

  return images.sort((a, b) => a.pageNumber - b.pageNumber);
}

// ====================================
// OCR with Tesseract (same as before)
// ====================================
export interface OCRBlock {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export async function runOcrOnImage(imagePath: string): Promise<OCRBlock[]> {
  const tsvOutput = path.join(OCR_TEMP_DIR, `ocr_${Date.now()}.tsv`);

  try {
    await exec("tesseract", [imagePath, tsvOutput.replace(".tsv", ""), "-l", OCR_LANG, "--psm", "3", "tsv"]);
  } catch (err) {
    console.error("Tesseract OCR failed:", err);
    return [];
  }

  const tsvData = await fs.readFile(tsvOutput, "utf-8");
  const lines = tsvData.split("\n").slice(1);

  const blocks: OCRBlock[] = lines
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 12 && cols[11]?.trim())
    .map((cols) => ({
      text: cols[11].trim(),
      confidence: parseFloat(cols[10]) || 0,
      bbox: {
        x0: parseFloat(cols[6]),
        y0: parseFloat(cols[7]),
        x1: parseFloat(cols[8]),
        y1: parseFloat(cols[9]),
      },
    }));

  return blocks;
}

// ====================================
// Enhanced Field Detection (OpenCV + OCR)
// ====================================
export interface EnhancedField {
  label: string;
  fieldType: "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX";
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  detectionMethod: "ocr" | "opencv" | "hybrid";
  pageNumber?: number;
}

export async function detectFieldsEnhanced(
  imagePath: string,
  ocrBlocks: OCRBlock[],
  pageNumber: number
): Promise<EnhancedField[]> {
  const fields: EnhancedField[] = [];

  // 1️⃣ Get form boxes from OpenCV contour detection
  const boxResult = await detectFormBoxes(imagePath);

  if (boxResult.success && boxResult.boxes) {
    console.log(`✓ OpenCV detected ${boxResult.boxes.length} form boxes on page ${pageNumber}`);

    // 2️⃣ Match boxes with nearby OCR labels
    for (const box of boxResult.boxes) {
      let nearestLabel = "";
      let minDistance = Infinity;

      // Find nearest OCR text above or to the left
      for (const block of ocrBlocks) {
        const labelY = block.bbox.y0;
        const labelX = block.bbox.x0;

        const isAbove = labelY < box.y && labelY > box.y - 100;
        const isLeft = labelX < box.x && labelX > box.x - 200;

        if (isAbove || isLeft) {
          const distance = Math.sqrt(
            Math.pow(labelX - box.x, 2) + Math.pow(labelY - box.y, 2)
          );

          if (distance < minDistance && block.text.trim().length > 0) {
            minDistance = distance;
            nearestLabel = block.text.trim();
          }
        }
      }

      // Classify field type
      let fieldType: EnhancedField["fieldType"] = "TEXT";
      const lowerLabel = nearestLabel.toLowerCase();

      if (box.type === "checkbox") {
        fieldType = "CHECKBOX";
      } else if (box.type === "signature_area" || /sign(ature)?/i.test(lowerLabel)) {
        fieldType = "SIGNATURE";
      } else if (/initial/i.test(lowerLabel)) {
        fieldType = "INITIALS";
      } else if (/date/i.test(lowerLabel)) {
        fieldType = "DATE";
      }

      fields.push({
        label: nearestLabel || box.type,
        fieldType,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        confidence: nearestLabel ? 90 : 70,
        detectionMethod: "opencv",
        pageNumber,
      });
    }
  }

  console.log(`✓ Detected ${fields.length} fields on page ${pageNumber}`);
  return fields;
}

// ====================================
// Complete OCR Pipeline with OpenCV
// ====================================
export async function runOCRWithOpenCV(pdfPath: string) {
  await ensureTempDir();

  console.log(`\n📄 Starting OpenCV-enhanced OCR for: ${path.basename(pdfPath)}`);

  // 1️⃣ Convert PDF to images
  const images = await convertPdfToImages(pdfPath);
  console.log(`✓ Converted to ${images.length} page(s)`);

  const allFields: EnhancedField[] = [];
  let fullText = "";

  // Process pages in parallel for speed (up to 3 at a time)
  const processPage = async (pageData: { pageNumber: number; imagePath: string }) => {
    const { pageNumber, imagePath } = pageData;
    console.log(`📄 Processing page ${pageNumber}...`);

    // 2️⃣ Lightweight preprocessing (skip expensive steps)
    const preprocessedPath = imagePath.replace(".png", "_preprocessed.png");
    const preprocessResult = await preprocessImage(imagePath, preprocessedPath, {
      deskew: true,           // Keep (important for rotated docs)
      denoise: false,         // Skip (slow, often not needed)
      binarize: true,         // Keep (fast and effective)
      enhanceContrast: true,  // Keep (fast and effective)
    });

    const imageToOCR = preprocessResult.success ? preprocessedPath : imagePath;

    // 3️⃣ Run Tesseract OCR
    const ocrBlocks = await runOcrOnImage(imageToOCR);
    console.log(`✓ Page ${pageNumber}: ${ocrBlocks.length} text blocks`);

    // 4️⃣ Field detection
    const pageFields = await detectFieldsEnhanced(imagePath, ocrBlocks, pageNumber);

    return {
      pageNumber,
      text: ocrBlocks.map(b => b.text).join(" ") + "\n\n",
      fields: pageFields,
    };
  };

  // Process pages in batches of 3 for parallel execution
  const batchSize = 3;
  const pageResults = [];

  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(processPage));
    pageResults.push(...results);
  }

  // Combine results
  pageResults.sort((a, b) => a.pageNumber - b.pageNumber);
  for (const result of pageResults) {
    fullText += result.text;
    allFields.push(...result.fields);
  }

  console.log(`\n✅ OCR complete: ${allFields.length} fields detected across ${images.length} pages`);

  return {
    fields: allFields,
    text: fullText,
    pageCount: images.length,
  };
}

// Export for compatibility
export { preprocessImage, detectFormBoxes };
