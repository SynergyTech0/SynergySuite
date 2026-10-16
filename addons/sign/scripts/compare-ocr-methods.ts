/**
 * Compare Basic Tesseract vs OpenCV+Tesseract
 * Run this to see the difference in accuracy
 */

import { convertPdfToImages, runOcrOnImage, detectFieldsFromOcr } from '../lib/ocr-utils';
import path from 'path';

async function compareOCRMethods() {
  console.log('=== OCR Method Comparison ===\n');

  // Test with a sample document
  const testPdf = process.argv[2] || '/var/www/ai_docusign_clone/uploads/documents/sample.pdf';

  console.log(`Testing with: ${path.basename(testPdf)}\n`);

  try {
    // Method 1: Basic Tesseract (your current approach)
    console.log('📄 Method 1: Basic Tesseract Only');
    console.log('─'.repeat(50));

    const start1 = Date.now();
    const images = await convertPdfToImages(testPdf);

    let basicFields = 0;
    let basicText = '';

    for (const { imagePath } of images) {
      const blocks = await runOcrOnImage(imagePath);
      basicText += blocks.map(b => b.text).join(' ');
      const fields = detectFieldsFromOcr(blocks);
      basicFields += fields.length;
    }

    const time1 = Date.now() - start1;

    console.log(`✓ Fields detected: ${basicFields}`);
    console.log(`✓ Text extracted: ${basicText.length} characters`);
    console.log(`✓ Processing time: ${(time1 / 1000).toFixed(2)}s`);
    console.log(`✓ Speed: ${(time1 / images.length).toFixed(0)}ms per page`);

    // Method 2: OpenCV + Tesseract (if installed)
    console.log('\n📄 Method 2: OpenCV + Tesseract');
    console.log('─'.repeat(50));

    try {
      // Try to load OpenCV
      const cv = require('@u4/opencv4nodejs');
      console.log(`✓ OpenCV ${cv.version} detected`);

      // Import enhanced functions
      const { runEnhancedOCR } = require('../lib/opencv-ocr-utils');

      const start2 = Date.now();
      const result = await runEnhancedOCR(testPdf);
      const time2 = Date.now() - start2;

      console.log(`✓ Fields detected: ${result.fields.length}`);
      console.log(`✓ Text extracted: ${result.text.length} characters`);
      console.log(`✓ Processing time: ${(time2 / 1000).toFixed(2)}s`);
      console.log(`✓ Speed: ${(time2 / images.length).toFixed(0)}ms per page`);
      console.log(`✓ Avg confidence: ${(result.fields.reduce((s: number, f: any) => s + f.confidence, 0) / result.fields.length).toFixed(1)}%`);

      // Comparison
      console.log('\n📊 Comparison');
      console.log('─'.repeat(50));
      console.log(`Field detection improvement: ${((result.fields.length / basicFields - 1) * 100).toFixed(1)}%`);
      console.log(`Processing time increase: ${((time2 / time1 - 1) * 100).toFixed(1)}%`);

      const improvement = result.fields.length - basicFields;
      if (improvement > 0) {
        console.log(`\n✅ OpenCV detected ${improvement} more field(s)`);
      } else if (improvement < 0) {
        console.log(`\n⚠️  Basic method detected ${-improvement} more field(s)`);
      } else {
        console.log(`\n➡️  Both methods detected the same number of fields`);
      }

    } catch (err: any) {
      console.log('❌ OpenCV not installed');
      console.log('\nTo install OpenCV:');
      console.log('  sudo apt-get install -y libopencv-dev');
      console.log('  npm install @u4/opencv4nodejs');
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

compareOCRMethods().catch(console.error);
