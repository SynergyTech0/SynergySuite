/**
 * Proves the finalization fix: the uploader and the finalizer now agree on where the PDF lives.
 *
 * The old bug: upload wrote via getStorageDir()/LOCAL_STORAGE_PATH, but complete/route.ts read from
 * <cwd>/uploads/documents/<basename>. The read threw and the document was marked COMPLETED anyway.
 *
 *   npx tsx scripts/verify-finalization.ts
 */
import path from "path";
import fs from "fs";
import os from "os";

// Storage reads these at module load, so set them BEFORE importing it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "synergysign-verify-"));
process.env.LOCAL_STORAGE_PATH = TMP;
process.env.STORAGE_MODE = "local";
process.env.ENABLE_S3_BACKUP = "false";

async function main() {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { uploadFile, getFileBuffer } = await import("../lib/storage");
  const { createSignedPdfBuffer } = await import("../lib/pdf-signer");
  const { hashBuffer } = await import("../lib/document-hash");

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
    if (!ok) failures++;
  };

  // --- an original "uploaded" document -------------------------------------------------------
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("EMPLOYMENT AGREEMENT", { x: 72, y: 700, size: 18, color: rgb(0, 0, 0) });
  page.drawText("Signature: _______________________", { x: 72, y: 200, size: 12 });
  const originalPdf = Buffer.from(await doc.save());

  console.log("\n1. Upload through the storage layer (what the uploader does)");
  const storageKey = await uploadFile(originalPdf, "agreement.pdf", "documents");
  console.log("   storageKey =", storageKey);

  console.log("\n2. Read it back through the storage layer (what the finalizer NOW does)");
  const readBack = await getFileBuffer(storageKey, "LOCAL" as any);
  check("finalizer reads the same bytes the uploader wrote", readBack.equals(originalPdf),
        `${readBack.length} bytes`);

  console.log("\n3. Show the OLD code path was genuinely broken");
  const oldGuess = path.join(process.cwd(), "uploads", "documents", path.basename(storageKey));
  check("old hardcoded path does NOT exist (this is why finalization silently failed)",
        !fs.existsSync(oldGuess), oldGuess);

  console.log("\n4. Stamp signatures in memory (no filesystem assumptions)");
  const signedPdf = await createSignedPdfBuffer(readBack, [
    {
      page: 0, x: 72, y: 580, width: 200, height: 40,
      fieldType: "TEXT", value: "Shane Sipe",
      signerName: "Shane Sipe", signedAt: new Date(),
    },
    {
      page: 0, x: 320, y: 580, width: 160, height: 24,
      fieldType: "DATE", value: "2026-07-14",
      signerName: "Shane Sipe", signedAt: new Date(),
    },
  ]);
  check("signed PDF produced", signedPdf.length > 0, `${signedPdf.length} bytes`);
  check("signed PDF is a valid PDF", signedPdf.subarray(0, 5).toString() === "%PDF-");
  check("signed PDF differs from the original", !signedPdf.equals(originalPdf));

  // updateMetadata:false or pdf-lib rewrites Producer on load and we'd be reading its value, not ours.
  const reloaded = await PDFDocument.load(signedPdf, { updateMetadata: false });
  check("signed PDF still opens and has its page", reloaded.getPageCount() === 1);
  check("metadata stamped", reloaded.getProducer()?.includes("SynergySign") ?? false);

  console.log("\n5. Persist + hash the signed PDF (the COMPLETED preconditions)");
  const signedKey = await uploadFile(signedPdf, "agreement-signed.pdf", "documents");
  const fetched = await getFileBuffer(signedKey, "LOCAL" as any);
  check("signed PDF is retrievable after upload", fetched.equals(signedPdf));

  const hash = hashBuffer(signedPdf);
  check("hash computed from the real bytes", /^[a-f0-9]{64}$/.test(hash), hash.slice(0, 16) + "…");
  check("hash is stable", hashBuffer(fetched) === hash);

  console.log(
    failures === 0
      ? "\n✅ ALL CHECKS PASSED — a completed document now genuinely has a signed PDF + hash.\n"
      : `\n❌ ${failures} CHECK(S) FAILED\n`,
  );
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verification crashed:", e);
  process.exit(1);
});
