/**
 * Document hashing utilities for immutability and integrity verification
 */

import crypto from 'crypto';
import fs from 'fs/promises';

/**
 * Generate SHA-256 hash of a file
 */
export async function generateDocumentHash(filePath: string): Promise<string> {
  return hashBuffer(await fs.readFile(filePath));
}

/**
 * SHA-256 of bytes already in hand. The signed PDF is produced in memory and may live in S3 rather
 * than on local disk, so hashing must not assume a readable local path.
 */
export function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Verify document hash
 */
export async function verifyDocumentHash(
  filePath: string,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await generateDocumentHash(filePath);
  return actualHash === expectedHash;
}

/**
 * Generate certificate of completion with hash
 */
export function generateCertificate(data: {
  documentTitle: string;
  documentHash: string;
  signers: Array<{
    name: string;
    email: string;
    signedAt: Date;
  }>;
  completedAt: Date;
}): string {
  const { documentTitle, documentHash, signers, completedAt } = data;

  return `
═══════════════════════════════════════════════════════════════
              CERTIFICATE OF COMPLETION
═══════════════════════════════════════════════════════════════

Document: ${documentTitle}
Completed: ${completedAt.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'long',
  })}

SIGNERS:
${signers
  .map(
    (s, i) => `
  ${i + 1}. ${s.name} (${s.email})
     Signed: ${s.signedAt.toLocaleString('en-US', {
       dateStyle: 'medium',
       timeStyle: 'short',
     })}`
  )
  .join('\n')}

DOCUMENT INTEGRITY:
  SHA-256 Hash: ${documentHash}

This hash can be used to verify that the document has not been
altered since signing. To verify:

  1. Calculate SHA-256 hash of the PDF file
  2. Compare with the hash above
  3. If they match, the document is authentic and unmodified

═══════════════════════════════════════════════════════════════
This certificate was generated electronically and is valid
without a signature or stamp.
═══════════════════════════════════════════════════════════════
  `.trim();
}
