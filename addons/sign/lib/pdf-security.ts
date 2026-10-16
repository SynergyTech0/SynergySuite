/**
 * PDF Security Scanner
 * Detects malicious content in PDF files without external libraries
 * Scans for: JavaScript, external links, embedded files, suspicious actions
 */

export interface SecurityScanResult {
  safe: boolean;
  threats: string[];
  warnings: string[];
  details: {
    hasJavaScript: boolean;
    hasExternalLinks: boolean;
    hasEmbeddedFiles: boolean;
    hasSuspiciousActions: boolean;
    suspiciousPatterns: string[];
  };
}

/**
 * Main security scan function
 * Analyzes PDF buffer for security threats
 */
export async function scanPDFSecurity(buffer: Buffer): Promise<SecurityScanResult> {
  const pdfContent = buffer.toString('binary');
  const threats: string[] = [];
  const warnings: string[] = [];

  // Check 1: Validate it's actually a PDF
  // Check first 1024 bytes for PDF header (some PDFs have preamble)
  const header = pdfContent.substring(0, 1024);
  const hasPdfHeader = header.includes('%PDF-');

  if (!hasPdfHeader) {
    // Log first 100 bytes for debugging
    const firstBytes = pdfContent.substring(0, 100);
    console.error('❌ PDF validation failed. First 100 bytes:', firstBytes.substring(0, 50));
    console.error('   Buffer size:', buffer.length);
    console.error('   Content type check: Looking for %PDF- in first 1024 bytes');

    threats.push('File does not appear to be a valid PDF');
    return {
      safe: false,
      threats,
      warnings,
      details: {
        hasJavaScript: false,
        hasExternalLinks: false,
        hasEmbeddedFiles: false,
        hasSuspiciousActions: false,
        suspiciousPatterns: ['Invalid PDF header'],
      },
    };
  }

  const details = {
    hasJavaScript: false,
    hasExternalLinks: false,
    hasEmbeddedFiles: false,
    hasSuspiciousActions: false,
    suspiciousPatterns: [] as string[],
  };

  // Check 2: Detect JavaScript
  const jsPatterns = [
    /\/JavaScript/gi,
    /\/JS\s*\(/gi,
    /\/OpenAction/gi,
    /\/AA\s*</gi, // Additional Actions
    /\/Launch/gi,
    /app\.alert/gi,
    /app\.launchURL/gi,
    /this\.submitForm/gi,
    /this\.exportDataObject/gi,
  ];

  for (const pattern of jsPatterns) {
    if (pattern.test(pdfContent)) {
      details.hasJavaScript = true;
      const match = pdfContent.match(pattern);
      if (match) {
        details.suspiciousPatterns.push(match[0]);
      }
      break;
    }
  }

  if (details.hasJavaScript) {
    threats.push('PDF contains embedded JavaScript');
  }

  // Check 3: Detect external links/URLs
  const urlPatterns = [
    /\/URI\s*\(/gi,
    /https?:\/\/[^\s)>]+/gi,
    /\/GoToR/gi, // Go to Remote
    /\/Launch/gi, // Launch external application
  ];

  let urlCount = 0;
  for (const pattern of urlPatterns) {
    const matches = pdfContent.match(pattern);
    if (matches) {
      urlCount += matches.length;
      details.suspiciousPatterns.push(...matches.slice(0, 3)); // First 3 examples
    }
  }

  if (urlCount > 0) {
    details.hasExternalLinks = true;
    if (urlCount > 50) {
      // Only block if there are an excessive number of links (likely phishing)
      threats.push(`PDF contains ${urlCount} external links (possible phishing attack)`);
    } else if (urlCount > 10) {
      warnings.push(`PDF contains ${urlCount} external links (review before signing)`);
    } else {
      warnings.push(`PDF contains ${urlCount} external link(s)`);
    }
  }

  // Check 4: Detect embedded files (attachments, not fonts/images)
  // Note: Most PDFs have embedded fonts and images, which is normal
  // We only warn about actual file attachments
  const embeddedFilePatterns = [
    /\/EmbeddedFile/gi,
    /\/FileAttachment/gi,
  ];

  let embeddedFileCount = 0;
  for (const pattern of embeddedFilePatterns) {
    const matches = pdfContent.match(pattern);
    if (matches) {
      embeddedFileCount += matches.length;
    }
  }

  if (embeddedFileCount > 0) {
    details.hasEmbeddedFiles = true;
    // Don't block - just warn. Embedded files can be legitimate (supporting documents)
    warnings.push(`PDF contains ${embeddedFileCount} embedded file(s) - review before signing`);
  }

  // Check 5: Detect suspicious actions
  const actionPatterns = [
    /\/SubmitForm/gi,
    /\/ImportData/gi,
    /\/GoTo\(http/gi,
    /\/Thread/gi,
    /\/Sound/gi,
    /\/Movie/gi,
    /\/RichMedia/gi,
  ];

  for (const pattern of actionPatterns) {
    const matches = pdfContent.match(pattern);
    if (matches) {
      details.hasSuspiciousActions = true;
      details.suspiciousPatterns.push(...matches.slice(0, 2));
    }
  }

  if (details.hasSuspiciousActions) {
    warnings.push('PDF contains form submission or media actions');
  }

  // Check 6: Detect obfuscation techniques
  const obfuscationPatterns = [
    /\/ASCIIHexDecode/gi,
    /\/ASCII85Decode/gi,
    /\/LZWDecode/gi,
    /\/FlateDecode.*\/FlateDecode/gi, // Multiple compression layers
  ];

  let obfuscationCount = 0;
  for (const pattern of obfuscationPatterns) {
    const matches = pdfContent.match(pattern);
    if (matches) {
      obfuscationCount += matches.length;
    }
  }

  if (obfuscationCount > 10) {
    warnings.push('PDF uses heavy obfuscation (suspicious)');
    details.suspiciousPatterns.push('Heavy encoding/obfuscation detected');
  }

  // Check 7: Detect shell commands or system calls
  const shellPatterns = [
    /cmd\.exe/gi,
    /powershell/gi,
    /\/bin\/sh/gi,
    /\/bin\/bash/gi,
    /system\(/gi,
    /exec\(/gi,
  ];

  for (const pattern of shellPatterns) {
    if (pattern.test(pdfContent)) {
      threats.push('PDF contains shell/system commands');
      details.suspiciousPatterns.push('Shell commands detected');
      break;
    }
  }

  // Check 8: File size anomalies
  const fileSize = buffer.length;
  const objectCount = (pdfContent.match(/\d+ \d+ obj/g) || []).length;
  
  if (objectCount > 1000 && fileSize < 100000) {
    warnings.push('Unusually high object count for file size (possible exploit)');
  }

  // Determine overall safety
  const safe = threats.length === 0;

  return {
    safe,
    threats,
    warnings,
    details,
  };
}

/**
 * Quick validation - returns true if safe to process
 */
export async function isSecurePDF(buffer: Buffer): Promise<boolean> {
  const result = await scanPDFSecurity(buffer);
  return result.safe;
}

/**
 * Sanitization recommendations
 */
export function getSecurityRecommendations(result: SecurityScanResult): string[] {
  const recommendations: string[] = [];

  if (result.details.hasJavaScript) {
    recommendations.push('Remove JavaScript using PDF sanitization tools');
  }
  
  if (result.details.hasEmbeddedFiles) {
    recommendations.push('Extract and scan embedded files separately');
  }
  
  if (result.details.hasExternalLinks) {
    recommendations.push('Review and verify all external links before signing');
  }
  
  if (result.details.hasSuspiciousActions) {
    recommendations.push('Disable auto-actions in PDF viewer settings');
  }

  if (recommendations.length === 0) {
    recommendations.push('Document appears safe for processing');
  }

  return recommendations;
}
