/**
 * Enhanced OCR with OpenCV preprocessing
 * Significantly improves accuracy on scanned documents
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import cv from "@u4/opencv4nodejs"; // Popular Node.js OpenCV binding

const exec = promisify(execFile);
const OCR_TEMP_DIR = "/tmp/ocr_pages";
const OCR_LANG = "eng";

// Ensure temp dir exists
async function ensureTempDir() {
  await fs.mkdir(OCR_TEMP_DIR, { recursive: true });
}

// ------------------------------
// 🎨 OpenCV Image Preprocessing
// ------------------------------

export interface PreprocessOptions {
  deskew?: boolean;          // Fix rotation/skew
  denoise?: boolean;         // Remove noise/artifacts
  binarize?: boolean;        // Convert to black & white
  enhanceContrast?: boolean; // Improve text visibility
  removeBackground?: boolean; // Remove background patterns
}

/**
 * Preprocess image using OpenCV for better OCR accuracy
 */
export async function preprocessImage(
  imagePath: string,
  options: PreprocessOptions = {}
): Promise<string> {
  const {
    deskew = true,
    denoise = true,
    binarize = true,
    enhanceContrast = true,
    removeBackground = false,
  } = options;

  try {
    // Read image
    let img = await cv.imreadAsync(imagePath);

    // Convert to grayscale
    let gray = await img.bgrToGrayAsync();

    // 1️⃣ Enhance contrast (CLAHE - Contrast Limited Adaptive Histogram Equalization)
    if (enhanceContrast) {
      const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
      gray = await clahe.applyAsync(gray);
    }

    // 2️⃣ Denoise (remove speckles and artifacts)
    if (denoise) {
      gray = await gray.fastNlMeansDenoising({
        h: 10,
        templateWindowSize: 7,
        searchWindowSize: 21,
      });
    }

    // 3️⃣ Deskew (fix rotation)
    if (deskew) {
      gray = await deskewImage(gray);
    }

    // 4️⃣ Remove background (useful for forms with watermarks)
    if (removeBackground) {
      const blur = await gray.gaussianBlur(new cv.Size(5, 5), 0);
      gray = await gray.sub(blur).add(100);
    }

    // 5️⃣ Binarization (convert to pure black & white)
    if (binarize) {
      // Adaptive thresholding works better than simple threshold
      gray = await gray.adaptiveThreshold(
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        11,
        2
      );
    }

    // Save preprocessed image
    const outputPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, "_preprocessed.png");
    await cv.imwriteAsync(outputPath, gray);

    return outputPath;
  } catch (err) {
    console.error("OpenCV preprocessing failed:", err);
    // Fallback to original image
    return imagePath;
  }
}

/**
 * Deskew image using Hough line detection
 */
async function deskewImage(gray: cv.Mat): Promise<cv.Mat> {
  try {
    // Detect edges
    const edges = await gray.canny(50, 150);

    // Detect lines using Hough transform
    const lines = await edges.houghLinesP(1, Math.PI / 180, 100, 100, 10);

    if (lines.length === 0) return gray;

    // Calculate average angle
    let angleSum = 0;
    let count = 0;

    for (const line of lines) {
      const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * (180 / Math.PI);

      // Only consider nearly horizontal or vertical lines
      if (Math.abs(angle) < 45) {
        angleSum += angle;
        count++;
      }
    }

    if (count === 0) return gray;

    const avgAngle = angleSum / count;

    // Only rotate if skew is significant (> 0.5 degrees)
    if (Math.abs(avgAngle) < 0.5) return gray;

    // Rotate image to correct skew
    const center = new cv.Point2(gray.cols / 2, gray.rows / 2);
    const rotMat = cv.getRotationMatrix2D(center, avgAngle, 1.0);
    const rotated = await gray.warpAffine(rotMat, new cv.Size(gray.cols, gray.rows), {
      borderValue: new cv.Vec(255, 255, 255),
    });

    console.log(`✓ Deskewed image by ${avgAngle.toFixed(2)}°`);
    return rotated;
  } catch (err) {
    console.error("Deskewing failed:", err);
    return gray;
  }
}

// ------------------------------
// 📦 Form Structure Detection
// ------------------------------

export interface DetectedBox {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "checkbox" | "textbox" | "signature_area";
}

/**
 * Detect form boxes using contour detection
 */
export async function detectFormBoxes(imagePath: string): Promise<DetectedBox[]> {
  try {
    const img = await cv.imreadAsync(imagePath);
    const gray = await img.bgrToGrayAsync();

    // Apply binary threshold
    const binary = await gray.threshold(127, 255, cv.THRESH_BINARY_INV);

    // Find contours
    const contours = await binary.findContours(
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    const boxes: DetectedBox[] = [];

    for (const contour of contours) {
      const rect = contour.boundingRect();
      const area = rect.width * rect.height;
      const aspectRatio = rect.width / rect.height;

      // Filter by size and shape
      // Checkbox: small, square-ish
      if (area > 100 && area < 1000 && aspectRatio > 0.8 && aspectRatio < 1.2) {
        boxes.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          type: "checkbox",
        });
      }
      // Text box: medium, horizontal rectangle
      else if (area > 1000 && area < 50000 && aspectRatio > 3 && aspectRatio < 15) {
        boxes.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          type: "textbox",
        });
      }
      // Signature area: large, horizontal rectangle
      else if (area > 10000 && area < 100000 && aspectRatio > 2 && aspectRatio < 5) {
        boxes.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          type: "signature_area",
        });
      }
    }

    console.log(`✓ Detected ${boxes.length} form boxes`);
    return boxes;
  } catch (err) {
    console.error("Box detection failed:", err);
    return [];
  }
}

// ------------------------------
// 🔍 Enhanced Field Detection
// ------------------------------

export interface EnhancedField {
  label: string;
  fieldType: "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX";
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number; // 0-100, how confident we are
  detectionMethod: "ocr" | "contour" | "hybrid";
}

/**
 * Combine OCR text detection with OpenCV contour detection
 */
export async function detectFieldsEnhanced(
  imagePath: string,
  ocrBlocks: any[]
): Promise<EnhancedField[]> {
  const fields: EnhancedField[] = [];

  // 1️⃣ Get form boxes from contour detection
  const boxes = await detectFormBoxes(imagePath);

  // 2️⃣ Match boxes with nearby OCR labels
  for (const box of boxes) {
    // Find nearest OCR text above or to the left
    let nearestLabel = "";
    let minDistance = Infinity;

    for (const block of ocrBlocks) {
      const labelY = block.bbox.y0;
      const labelX = block.bbox.x0;

      // Label should be above or to the left of the box
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

    // Classify field type based on box type and label
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
      confidence: nearestLabel ? 85 : 60, // Higher confidence if we found a label
      detectionMethod: "hybrid",
    });
  }

  console.log(`✓ Detected ${fields.length} fields using hybrid method`);
  return fields;
}

// ------------------------------
// 📊 Complete Pipeline
// ------------------------------

export async function runEnhancedOCR(pdfPath: string) {
  await ensureTempDir();

  // 1️⃣ Convert PDF to images (same as before)
  const images = await convertPdfToImages(pdfPath);

  const allFields: EnhancedField[] = [];
  let fullText = "";

  for (const { pageNumber, imagePath } of images) {
    console.log(`\n📄 Processing page ${pageNumber}...`);

    // 2️⃣ Preprocess image with OpenCV
    const preprocessedPath = await preprocessImage(imagePath, {
      deskew: true,
      denoise: true,
      binarize: true,
      enhanceContrast: true,
    });

    // 3️⃣ Run Tesseract OCR on preprocessed image
    const ocrBlocks = await runOcrOnImage(preprocessedPath);
    fullText += ocrBlocks.map(b => b.text).join(" ") + "\n\n";

    // 4️⃣ Enhanced field detection (hybrid OCR + contours)
    const pageFields = await detectFieldsEnhanced(preprocessedPath, ocrBlocks);

    // Add page number to fields
    allFields.push(...pageFields.map(f => ({ ...f, pageNumber })));
  }

  return {
    fields: allFields,
    text: fullText,
    pageCount: images.length,
  };
}

// Helper function to convert PDF to images (reuse from existing code)
async function convertPdfToImages(pdfPath: string) {
  // ... (same implementation as your existing code)
  return [];
}

// Helper function to run OCR (reuse from existing code)
async function runOcrOnImage(imagePath: string) {
  // ... (same implementation as your existing code)
  return [];
}
