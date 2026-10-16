/**
 * PDF signing utilities
 * Creates final signed PDF with all signatures burned in
 */

import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export interface SignatureData {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData?: string; // base64 signature image (for SIGNATURE/INITIALS)
  value?: string; // text value (for TEXT/DATE/CHECKBOX)
  // Must cover every Prisma FieldType. DROPDOWN was missing, so a dropdown's selected value matched
  // no branch below and was silently omitted from the signed PDF.
  fieldType: 'SIGNATURE' | 'INITIALS' | 'TEXT' | 'DATE' | 'CHECKBOX' | 'DROPDOWN';
  signerName: string;
  signedAt: Date;
}

/**
 * Create the final signed PDF, in memory.
 *
 * This is the real implementation and it deliberately does NO file IO: the original bytes come in,
 * the stamped bytes come out. Callers own storage, which is what lets the caller respect
 * STORAGE_MODE (local/s3/hybrid). The previous path-in/path-out design hard-wired this to the local
 * filesystem — and because the caller guessed a different directory than the uploader wrote to, the
 * read threw and finalization was silently abandoned.
 */
export async function createSignedPdfBuffer(
  originalPdf: Buffer,
  signatures: SignatureData[]
): Promise<Buffer> {
  // updateMetadata:false — pdf-lib otherwise rewrites Producer/ModDate on save, silently discarding
  // the SynergySign provenance metadata we set below.
  const pdfDoc = await PDFDocument.load(originalPdf, { updateMetadata: false });
  await stampSignatures(pdfDoc, signatures);
  return Buffer.from(await pdfDoc.save());
}

/**
 * Path-in/path-out convenience wrapper. Prefer createSignedPdfBuffer + lib/storage.
 */
export async function createSignedPDF(
  originalPdfPath: string,
  signatures: SignatureData[],
  outputPath: string
): Promise<void> {
  const original = await fs.readFile(originalPdfPath);
  const signed = await createSignedPdfBuffer(original, signatures);
  await fs.writeFile(outputPath, signed);
}

async function stampSignatures(
  pdfDoc: PDFDocument,
  signatures: SignatureData[]
): Promise<void> {

  // Get all pages
  const pages = pdfDoc.getPages();

  // Add each field to the PDF
  for (const sig of signatures) {
    if (sig.page < 0 || sig.page >= pages.length) {
      console.warn(`Invalid page number ${sig.page}, skipping field`);
      continue;
    }

    const page = pages[sig.page];
    const pageHeight = page.getHeight();

    try {
      // Calculate position (convert from top-left to bottom-left coordinates)
      const yPosition = pageHeight - sig.y - sig.height;

      // Handle different field types
      if (sig.fieldType === 'SIGNATURE' || sig.fieldType === 'INITIALS') {
        // Handle signature/initials images
        if (!sig.imageData) {
          console.warn(`No image data for ${sig.fieldType} field`);
          continue;
        }

        // Convert base64 signature to image
        const imageData = sig.imageData.replace(/^data:image\/\w+;base64,/, '');
        const imageBytes = Buffer.from(imageData, 'base64');

        // Embed image (try PNG first, fallback to JPEG)
        let image;
        try {
          image = await pdfDoc.embedPng(imageBytes);
        } catch {
          try {
            image = await pdfDoc.embedJpg(imageBytes);
          } catch {
            console.error(`Failed to embed signature image for ${sig.signerName}`);
            continue;
          }
        }

        // Draw signature image
        page.drawImage(image, {
          x: sig.x,
          y: yPosition,
          width: sig.width,
          height: sig.height,
        });

        // Add signed date below signature (small text)
        const fontSize = 8;
        const dateText = `Signed: ${sig.signedAt.toLocaleDateString()}`;

        page.drawText(dateText, {
          x: sig.x,
          y: yPosition - 12,
          size: fontSize,
          color: rgb(0.5, 0.5, 0.5),
        });
      } else if (sig.fieldType === 'TEXT' || sig.fieldType === 'DATE' || sig.fieldType === 'DROPDOWN') {
        // Handle text, date and dropdown fields — a dropdown's selected option is just text.
        if (!sig.value) {
          console.warn(`No value for ${sig.fieldType} field`);
          continue;
        }

        // Draw text
        const fontSize = Math.min(sig.height * 0.6, 12); // Scale font to field height
        page.drawText(sig.value, {
          x: sig.x + 4, // Small padding
          y: yPosition + (sig.height / 2) - (fontSize / 2), // Center vertically
          size: fontSize,
          color: rgb(0, 0, 0),
        });
      } else if (sig.fieldType === 'CHECKBOX') {
        // Handle checkbox fields
        if (sig.value === 'true' || sig.value === 'checked') {
          // Draw a checkmark
          const checkSize = Math.min(sig.width, sig.height) * 0.6;
          const centerX = sig.x + sig.width / 2;
          const centerY = yPosition + sig.height / 2;

          // Draw checkmark using text (✓)
          page.drawText('✓', {
            x: centerX - checkSize / 2,
            y: centerY - checkSize / 2,
            size: checkSize,
            color: rgb(0, 0.5, 0),
          });
        }
      }
    } catch (err) {
      console.error(`Error adding field for ${sig.signerName}:`, err);
    }
  }

  // Add metadata
  pdfDoc.setTitle('Signed Document');
  pdfDoc.setProducer('SynergySign - Document Signing Platform');
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());
}

/**
 * Generate filename for signed document
 */
export function generateSignedFilename(originalFilename: string): string {
  const ext = path.extname(originalFilename);
  const nameWithoutExt = path.basename(originalFilename, ext);
  const timestamp = Date.now();

  return `${nameWithoutExt}_signed_${timestamp}${ext}`;
}
