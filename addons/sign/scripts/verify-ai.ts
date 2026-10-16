/**
 * Proves the AI layer is REAL — against the live AI model, on a document with signature blocks at known
 * coordinates. The bar: suggested SIGNATURE fields must land near the ACTUAL signature lines, not
 * at the old hardcoded (100,600).
 *
 *   npx tsx scripts/verify-ai.ts
 */
import path from "path";


// Where we actually draw the signature lines — the AI must find THESE.
const SIG_LINE = { page: 1, employerY: 590, employeeY: 660, labelX: 72 };

async function main() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const { extractLayout } = await import("../lib/ai/extract");
  const { analyzeDocument } = await import("../lib/ai/analyze");
  const { isAiConfigured } = await import("../lib/ai/client");

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
    if (!ok) failures++;
  };

  if (!isAiConfigured()) {
    console.error("AI_API_KEY and AI_MODEL must be set — cannot verify real AI.");
    process.exit(1);
  }

  // ---- build a realistic employment agreement ------------------------------------------------
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const T = (t: string, x: number, y: number, size = 11, f = font) =>
    page.drawText(t, { x, y, size, font: f, color: rgb(0, 0, 0) });

  // pdf-lib draws with a BOTTOM-LEFT origin; our extractor reports TOP-LEFT. Convert for assertions.
  const toTopLeft = (yBottom: number) => 792 - yBottom;

  T("EMPLOYMENT AGREEMENT", 72, 730, 16, bold);
  T("This Employment Agreement is entered into as of March 1, 2026 between", 72, 700);
  T("Acme Robotics Inc. (the \"Employer\") and Dana Whitfield (the \"Employee\").", 72, 684);
  T("1. Position. Employee shall serve as Senior Engineer.", 72, 650);
  T("2. Compensation. Employer shall pay Employee $180,000 annually.", 72, 630);
  T("3. Term. Employment shall commence on April 1, 2026.", 72, 610);
  T("4. Governing Law. This Agreement is governed by the laws of Delaware.", 72, 590);
  T("IN WITNESS WHEREOF, the parties have executed this Agreement.", 72, 550, 11, bold);

  // EMPLOYER signature block (drawn at bottom-left y=202 -> top-left y=590)
  T("EMPLOYER:", 72, 220, 11, bold);
  T("Signature: ______________________________", 72, 202);
  T("Printed Name: ___________________________", 72, 182);
  T("Date: ____________________", 72, 162);

  // EMPLOYEE signature block (drawn at bottom-left y=132 -> top-left y=660)
  T("EMPLOYEE:", 72, 150, 11, bold);
  T("Signature: ______________________________", 72, 132);
  T("Printed Name: ___________________________", 72, 112);
  T("Date: ____________________", 72, 92);

  const pdf = Buffer.from(await doc.save());
  console.log(`\nBuilt a 1-page Employment Agreement (${pdf.length} bytes).`);
  console.log(`Real signature lines sit at top-left y≈${toTopLeft(202)} (employer) and y≈${toTopLeft(132)} (employee).`);

  // ---- 1. geometry extraction ----------------------------------------------------------------
  console.log("\n1. Extract layout WITH coordinates");
  const layout = await extractLayout(pdf);
  check("page geometry read", layout.pages.length === 1 && layout.pages[0].width === 612,
        `${layout.pages[0].width}x${layout.pages[0].height}`);
  check("text runs carry positions", layout.pages[0].runs.length > 10,
        `${layout.pages[0].runs.length} runs`);
  const sigRun = layout.pages[0].runs.find((r) => r.text.includes("Signature"));
  check("found a 'Signature:' line with a real y", !!sigRun, sigRun ? `y=${sigRun.y}` : "not found");

  // ---- 2. the live AI model analysis ---------------------------------------------------------------
  console.log("\n2. Analyze with the live AI model (this is a real API call)…");
  const t0 = Date.now();
  const a = await analyzeDocument(pdf);
  console.log(`   took ${((Date.now() - t0) / 1000).toFixed(1)}s using ${a.model}`);

  console.log("\n3. Classification / summary / parties");
  check("classified as EMPLOYMENT_AGREEMENT", a.documentType === "EMPLOYMENT_AGREEMENT", a.documentType);
  check("summary is real prose", a.summary.length > 40, `"${a.summary.slice(0, 70)}…"`);
  check("keywords extracted", a.keywords.length >= 3, a.keywords.slice(0, 5).join(", "));
  check("governing law found", (a.governingLaw ?? "").toLowerCase().includes("delaware"), String(a.governingLaw));
  check("both parties detected", a.parties.length === 2,
        a.parties.map((p) => `${p.role}${p.name ? " (" + p.name + ")" : ""}`).join(" | "));
  check("party names lifted from the text",
        a.parties.some((p) => (p.name ?? "").includes("Dana")) &&
        a.parties.some((p) => (p.name ?? "").toLowerCase().includes("acme")));

  console.log("\n4. FIELD PLACEMENT — the thing that was hardcoded");
  const sigs = a.suggestedFields.filter((f) => f.fieldType === "SIGNATURE");
  console.log("   suggested fields:");
  for (const f of a.suggestedFields) {
    console.log(`     ${f.fieldType.padEnd(9)} p${f.pageNumber} (${f.x},${f.y}) ${f.width}x${f.height}  ${f.partyRole} — ${f.label} [conf ${f.confidence}]`);
  }

  check("suggested at least 2 signature fields (one per party)", sigs.length >= 2, `${sigs.length}`);
  check("NOT the old hardcoded coordinates",
        !a.suggestedFields.some((f) => (f.x === 100 && f.y === 600) || (f.x === 350 && f.y === 600)));

  // The real test: signature fields land near the ACTUAL signature lines.
  const near = (v: number, target: number, tol = 45) => Math.abs(v - target) <= tol;
  const employerSig = sigs.find((f) => near(f.y, SIG_LINE.employerY));
  const employeeSig = sigs.find((f) => near(f.y, SIG_LINE.employeeY));
  check(`a SIGNATURE field lands on the EMPLOYER line (y≈${SIG_LINE.employerY})`, !!employerSig,
        employerSig ? `y=${employerSig.y}` : `got: ${sigs.map((s) => s.y).join(", ")}`);
  check(`a SIGNATURE field lands on the EMPLOYEE line (y≈${SIG_LINE.employeeY})`, !!employeeSig,
        employeeSig ? `y=${employeeSig.y}` : `got: ${sigs.map((s) => s.y).join(", ")}`);

  check("every field is inside the page", a.suggestedFields.every(
    (f) => f.x >= 0 && f.y >= 0 && f.x + f.width <= 612 && f.y + f.height <= 792));
  check("fields are assigned to detected parties", a.suggestedFields.every(
    (f) => a.parties.some((p) => p.role === f.partyRole)));
  check("a DATE field was placed", a.suggestedFields.some((f) => f.fieldType === "DATE"));

  console.log("\n5. Compliance");
  console.log("   flags:", a.complianceFlags.length
    ? a.complianceFlags.map((f) => `[${f.severity}] ${f.issue}`).join("\n          ")
    : "(none)");
  check("compliance analysis ran (array present)", Array.isArray(a.complianceFlags));

  console.log(
    failures === 0
      ? "\n✅ ALL CHECKS PASSED — the AI is real: it read the document, found the parties, and placed fields on the ACTUAL signature lines.\n"
      : `\n❌ ${failures} CHECK(S) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verification crashed:", e);
  process.exit(1);
});
