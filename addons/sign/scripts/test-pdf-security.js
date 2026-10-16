#!/usr/bin/env node

/**
 * Test PDF Security Scanner
 * Run this to check what security issues are detected in a PDF file
 *
 * Usage: node scripts/test-pdf-security.js <path-to-pdf>
 */

const fs = require('fs');
const path = require('path');

// Import the security scanner (you may need to adjust the path)
const { scanPDFSecurity, getSecurityRecommendations } = require('../lib/pdf-security.ts');

async function testPdfSecurity(pdfPath) {
  try {
    console.log('🔍 Testing PDF Security Scanner\n');
    console.log(`File: ${pdfPath}\n`);

    // Read the PDF file
    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ File not found: ${pdfPath}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(pdfPath);
    console.log(`✓ File loaded: ${(buffer.length / 1024).toFixed(2)} KB\n`);

    // Run security scan
    const scan = await scanPDFSecurity(buffer);

    // Display results
    console.log('═══════════════════════════════════════════════════');
    console.log('                 SCAN RESULTS');
    console.log('═══════════════════════════════════════════════════\n');

    // Overall status
    if (scan.safe) {
      console.log('✅ STATUS: SAFE - Upload will succeed\n');
    } else {
      console.log('❌ STATUS: BLOCKED - Upload will be rejected\n');
    }

    // Threats (blocking issues)
    if (scan.threats.length > 0) {
      console.log('🚨 THREATS (Will Block Upload):');
      scan.threats.forEach((threat, i) => {
        console.log(`   ${i + 1}. ${threat}`);
      });
      console.log('');
    } else {
      console.log('✓ No blocking threats detected\n');
    }

    // Warnings (non-blocking issues)
    if (scan.warnings.length > 0) {
      console.log('⚠️  WARNINGS (Upload Allowed):');
      scan.warnings.forEach((warning, i) => {
        console.log(`   ${i + 1}. ${warning}`);
      });
      console.log('');
    } else {
      console.log('✓ No warnings\n');
    }

    // Details
    console.log('📋 DETAILS:');
    console.log(`   JavaScript: ${scan.details.hasJavaScript ? '❌ YES' : '✓ No'}`);
    console.log(`   External Links: ${scan.details.hasExternalLinks ? '⚠️  Yes' : '✓ No'}`);
    console.log(`   Embedded Files: ${scan.details.hasEmbeddedFiles ? '⚠️  Yes' : '✓ No'}`);
    console.log(`   Suspicious Actions: ${scan.details.hasSuspiciousActions ? '⚠️  Yes' : '✓ No'}`);
    console.log('');

    // Suspicious patterns
    if (scan.details.suspiciousPatterns.length > 0) {
      console.log('🔎 SUSPICIOUS PATTERNS DETECTED:');
      scan.details.suspiciousPatterns.slice(0, 5).forEach((pattern, i) => {
        console.log(`   ${i + 1}. ${pattern}`);
      });
      if (scan.details.suspiciousPatterns.length > 5) {
        console.log(`   ... and ${scan.details.suspiciousPatterns.length - 5} more`);
      }
      console.log('');
    }

    // Recommendations
    const recommendations = getSecurityRecommendations(scan);
    if (recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════\n');

    // Summary
    if (scan.safe) {
      console.log('✅ This PDF will upload successfully!');
    } else {
      console.log('❌ This PDF will be BLOCKED on upload.');
      console.log('   Fix the threats listed above or contact your admin.');
    }

    process.exit(scan.safe ? 0 : 1);

  } catch (error) {
    console.error('❌ Error testing PDF:', error.message);
    process.exit(1);
  }
}

// Get PDF path from command line
const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error('Usage: node scripts/test-pdf-security.js <path-to-pdf>');
  console.error('Example: node scripts/test-pdf-security.js ./test-document.pdf');
  process.exit(1);
}

testPdfSecurity(pdfPath);
