import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
const exec = promisify(execFile);

// ------------------------------
// CONFIGURATION
// ------------------------------
const OCR_TEMP_DIR = "/tmp/ocr_pages";
const OCR_LANG = "eng";

// Ensure temp dir exists
async function ensureTempDir() {
  await fs.mkdir(OCR_TEMP_DIR, { recursive: true });
}

// ------------------------------
// 1️⃣ Convert PDF → Images (using Poppler or ImageMagick)
// ------------------------------
export async function convertPdfToImages(pdfPath: string): Promise<{ pageNumber: number; imagePath: string }[]> {
  await ensureTempDir();
  const outputPrefix = path.join(OCR_TEMP_DIR, `page_${Date.now()}`);

let resolvedPdfPath = pdfPath;
if (!path.isAbsolute(pdfPath)) {
  // handle both /root and /home/ubuntu cases
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
    // Prefer Poppler if installed
    await exec("pdftoppm", [resolvedPdfPath, outputPrefix, "-png"]);
  } catch (err) {
    console.warn("pdftoppm not found, trying ImageMagick convert");
    await exec("convert", ["-density", "200", resolvedPdfPath, `${outputPrefix}-%03d.png`]);
  }

  // Collect generated images
  const files = await fs.readdir(OCR_TEMP_DIR);
  const images = files
    .filter((f) => f.startsWith(path.basename(outputPrefix)))
    .map((f) => ({
      pageNumber: parseInt(f.match(/(\d+)/)?.[0] ?? "1", 10),
      imagePath: path.join(OCR_TEMP_DIR, f),
    }));

  return images.sort((a, b) => a.pageNumber - b.pageNumber);
}

// Helper to check if a file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------
// 2️⃣ Run OCR and return bounding boxes
// ------------------------------
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
  const lines = tsvData.split("\n").slice(1); // skip header

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

// ------------------------------
// 3️⃣ Heuristic auto-field detection
// ------------------------------
export interface DetectedField {
  label: string;
  fieldType: "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX";
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
  suggestedParty?: string; // NEW: Suggested signer/party (e.g., "Employee", "Employer")
}

export function detectFieldsFromOcr(blocks: OCRBlock[]): DetectedField[] {
  const detected: DetectedField[] = [];
  const processedAreas: { x: number; y: number }[] = [];
  const MIN_DISTANCE = 50; // Minimum distance to avoid duplicates

  // 🔍 STRATEGY: Only detect BLANK spaces (underscores), look at text BEFORE blank to classify
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.text;

    // 🚫 STRICT: Only process blocks with SIGNIFICANT underscores (5+ consecutive)
    // This filters out decorative elements or OCR noise
    const underscoreMatch = text.match(/_{5,}/);
    if (!underscoreMatch) continue;

    console.log(`🔍 OCR found underscore block: "${text}"`);

    // 🚫 STRICT: Skip if the block is ONLY underscores (no label context)
    // This avoids creating fields for decorative lines
    if (/^_+$/.test(text.trim())) {
      // Only accept if there's a clear label in the previous block
      if (i === 0) continue; // Skip if it's the first block

      const prevBlock = blocks[i - 1];
      const prevText = prevBlock.text.trim();

      // Skip if previous block is also just underscores or too short
      if (/^_+$/.test(prevText) || prevText.length < 2) continue;
    }

    // Extract the underscore position and preceding label
    let labelText = "";
    let blankX = block.bbox.x0;
    let blankY = block.bbox.y0;
    let blankWidth = block.bbox.x1 - block.bbox.x0;
    let blankHeight = block.bbox.y1 - block.bbox.y0;

    // Case 1: Label and blank in SAME block (e.g., "Employee: _____")
    const sameLineMatch = text.match(/^(.+?)[\s:]*(_+)/);
    if (sameLineMatch && sameLineMatch[1].trim().length > 0) {
      labelText = sameLineMatch[1].trim();

      // 🚫 STRICT: Label must have meaningful content (not just punctuation)
      if (!/[a-zA-Z]{2,}/.test(labelText)) {
        labelText = ""; // Reset if label doesn't have at least 2 letters
      } else {
        // Try to estimate where underscores start (proportional to text)
        const labelLength = sameLineMatch[1].length;
        const totalLength = text.length;
        const labelRatio = labelLength / totalLength;

        // Adjust blank X position to start after label
        const blockWidth = block.bbox.x1 - block.bbox.x0;
        blankX = block.bbox.x0 + (blockWidth * labelRatio);
        blankWidth = blockWidth * (1 - labelRatio);
      }
    }

    // Case 2: Label in PREVIOUS block (e.g., "Employee" on line, "____" below)
    if (!labelText && i > 0) {
      const prevBlock = blocks[i - 1];
      const verticalDistance = Math.abs(block.bbox.y0 - prevBlock.bbox.y0);
      const horizontalDistance = Math.abs(block.bbox.x0 - prevBlock.bbox.x0);

      // If previous block is nearby (same line or close), it's likely the label
      if (verticalDistance < 40 && horizontalDistance < 200) {
        const candidateLabel = prevBlock.text.trim().replace(/[:]+$/, '');

        // 🚫 STRICT: Previous block must have meaningful text
        if (/[a-zA-Z]{2,}/.test(candidateLabel) && !/_/.test(candidateLabel)) {
          labelText = candidateLabel;
        }
      }
    }

    // 🚫 STRICT: If we can't find a meaningful label, skip this blank
    if (!labelText || labelText.length < 2) continue;

    // 🚫 FINAL CHECK: Verify this block actually contains underscores
    // This is a safeguard against OCR misrecognition
    if (!text.includes('_')) {
      console.warn(`⚠️  Skipping block - no underscores found: "${text}"`);
      continue;
    }

    // 🎯 CLASSIFY based on the text BEFORE the blank
    const lowerLabel = labelText.toLowerCase();
    let fieldType: DetectedField["fieldType"] = "TEXT"; // Default
    let displayLabel = labelText;
    let required = false;
    let suggestedParty: string | undefined = undefined; // NEW: Track which party should fill this

    // Pattern matching for field types AND party identification
    if (/\b(employee|worker|staff)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Employee";
      suggestedParty = "Employee";
    }
    else if (/\b(employer|company|organization|business)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Employer";
      suggestedParty = "Employer";
    }
    else if (/\b(sign(ature)?|signed?\s*by|sign\s*here)\b/i.test(lowerLabel)) {
      fieldType = "SIGNATURE";
      displayLabel = "Signature";
      required = true;
      // Try to identify party from context (e.g., "Employee Signature")
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(initial(s)?|init\.)\b/i.test(lowerLabel)) {
      fieldType = "INITIALS";
      displayLabel = "Initials";
      required = true;
      // Try to identify party from context
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(date|day|month|year)\b/i.test(lowerLabel)) {
      fieldType = "DATE";
      displayLabel = "Date";
      // Try to identify party from context (e.g., "Employee Date")
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(name|full\s*name|first\s*name|last\s*name)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = lowerLabel.includes("full") ? "Full Name" :
                     lowerLabel.includes("first") ? "First Name" :
                     lowerLabel.includes("last") ? "Last Name" : "Name";
      // Check for party context
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(address|street|city|state|zip)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Address";
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(email|e-mail)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Email";
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(phone|telephone|cell|mobile)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Phone";
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(title|position|role|job)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Title";
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }
    else if (/\b(ssn|social\s*security|tax\s*id)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "SSN";
      suggestedParty = "Employee"; // SSN typically belongs to employee
    }
    else if (/\b(salary|wage|pay|compensation)\b/i.test(lowerLabel)) {
      fieldType = "TEXT";
      displayLabel = "Salary";
      suggestedParty = "Employee"; // Salary info typically employee's
    }
    else if (/\b(start\s*date|begin|commence)\b/i.test(lowerLabel)) {
      fieldType = "DATE";
      displayLabel = "Start Date";
      suggestedParty = "Employee"; // Start date typically for employee
    }
    else {
      // Default: use the label text as-is
      fieldType = "TEXT";
      displayLabel = labelText;
      // Try to extract party from the label itself
      if (/employee/i.test(lowerLabel)) {
        suggestedParty = "Employee";
      } else if (/employer/i.test(lowerLabel)) {
        suggestedParty = "Employer";
      }
    }

    // Check for duplicates
    const isDuplicate = processedAreas.some(
      (area) => Math.abs(area.x - blankX) < MIN_DISTANCE && Math.abs(area.y - blankY) < MIN_DISTANCE
    );

    if (isDuplicate) continue;
    processedAreas.push({ x: blankX, y: blankY });

    // Set field dimensions based on type, using actual blank width as base
    const minWidth = fieldType === "SIGNATURE" ? 200 :
                     fieldType === "INITIALS" ? 80 :
                     fieldType === "CHECKBOX" ? 20 : 100;

    const minHeight = fieldType === "SIGNATURE" ? 50 :
                      fieldType === "INITIALS" ? 30 :
                      fieldType === "CHECKBOX" ? 20 : 25;

    const finalWidth = Math.max(blankWidth, minWidth);
    const finalHeight = Math.max(blankHeight, minHeight);

    // Add the detected field - box drawn ONLY over the blank
    console.log(`✅ Creating field: "${displayLabel}" (${fieldType}) at (${Math.round(blankX)}, ${Math.round(blankY)}) - Party: ${suggestedParty || 'none'}`);

    detected.push({
      label: displayLabel,
      fieldType,
      x: blankX,
      y: blankY,
      width: finalWidth,
      height: finalHeight,
      required,
      suggestedParty, // Include party suggestion
    });
  }

  console.log(`📊 Total fields detected: ${detected.length}`);
  return detected;
}

// ------------------------------
// 4️⃣ Extractive summarizer
// ------------------------------
export async function summarizeText(fullText: string, maxChars = 600): Promise<string> {
  if (!fullText) return "";

  const sentences = fullText.split(/(?<=[.?!])\s+/);
  const wordFreq: Record<string, number> = {};

  for (const s of sentences) {
    for (const w of s.toLowerCase().split(/\W+/)) {
      if (w.length > 3) wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  }

  const sentenceScores = sentences.map((s) => ({
    s,
    score: s
      .toLowerCase()
      .split(/\W+/)
      .reduce((acc, w) => acc + (wordFreq[w] || 0), 0),
  }));

  sentenceScores.sort((a, b) => b.score - a.score);

  let summary = "";
  for (const { s } of sentenceScores) {
    if ((summary + " " + s).length > maxChars) break;
    summary += " " + s;
  }

  return summary.trim();
}
export async function getSummary(text: string): Promise<string> {
  try {
    if (!text) return 'No readable text found.';

    // Simple extractive summarizer: take top sentences by length / keyword density
    const sentences = text
      .replace(/\s+/g, ' ')
      .split(/[.!?]/)
      .map(s => s.trim())
      .filter(Boolean);

    if (sentences.length <= 3) return text.slice(0, 500);

    // Pick top 3 sentences that contain common key terms
    const keywords = ['agreement', 'name', 'date', 'signature', 'party', 'terms'];
    const ranked = sentences
      .map(s => ({
        sentence: s,
        score: keywords.reduce(
          (sum, k) => (s.toLowerCase().includes(k) ? sum + 1 : sum),
          0
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.sentence);

    return ranked.join('. ') + '.';
  } catch (err) {
    console.error('Summarization failed:', err);
    return 'Summary unavailable.';
  }
}
