/**
 * Measures how far each AI-placed field lands from the line it is supposed to sit on.
 *
 * We draw the rules ourselves, so we know the ground truth exactly. A field is "on the line" when
 * its bottom edge rests on the rule's baseline (that is where a human signs).
 *
 *   npx tsx scripts/verify-anchors.ts
 */


async function main() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const { extractLayout, detectAnchors } = await import("../lib/ai/extract");
  const { analyzeDocument } = await import("../lib/ai/analyze");

  let failures = 0;
  const check = (name: string, ok: boolean, extra = "") => {
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
    if (!ok) failures++;
  };

  // ---- a document whose rules we know the exact position of --------------------------------
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const T = (t: string, x: number, y: number, s = 11, f = font) =>
    page.drawText(t, { x, y, size: s, font: f, color: rgb(0, 0, 0) });

  T("SERVICES AGREEMENT", 72, 730, 16, bold);
  T("Between Orion Freight Co. (the \"Provider\") and Lena Ortiz (the \"Customer\"),", 72, 700);
  T("effective May 1, 2026, governed by the laws of Texas.", 72, 684);
  T("IN WITNESS WHEREOF:", 72, 560, 11, bold);
  T("PROVIDER:", 72, 300, 11, bold);
  T("Signature: ______________________________", 72, 280);
  T("Date: ____________________", 72, 258);
  T("CUSTOMER:", 72, 200, 11, bold);
  T("Signature: ______________________________", 72, 180);
  T("Date: ____________________", 72, 158);

  const pdf = Buffer.from(await doc.save());

  // ---- 1. anchors: do we find the real rules, with real geometry? ---------------------------
  console.log("\n1. Anchor detection (geometry straight from the PDF)");
  const layout = await extractLayout(pdf);
  const anchors = detectAnchors(layout);
  for (const a of anchors)
    console.log(`   ${a.id}  "${a.label}"  x=${a.x} y=${a.y} w=${a.width} baseline=${a.baseline}`);
  check("found all 4 fill-in rules", anchors.length === 4, `${anchors.length}`);
  check("rules start AFTER their label (x > line start)", anchors.every((a) => a.x > 72));

  // ---- 2. the live AI model, then snap ------------------------------------------------------------
  console.log("\n2. Analyze + snap (the live AI model)…");
  const a = await analyzeDocument(pdf);

  // Fields reference the numbered anchors (A1..An) the analysis showed the model.
  const { collectAnchors } = await import("../lib/ai/analyze");
  const numbered = (await collectAnchors(layout, pdf)).anchors;
  const anchorById = new Map(numbered.map((x) => [x.id, x]));
  console.log("\n3. Where each field landed vs the line it belongs on");
  console.log("   FIELD      PARTY        ANCHOR   field-bottom   rule-baseline   ERROR   snapped");

  let worst = 0;
  for (const f of a.suggestedFields) {
    const anc = f.anchorId ? anchorById.get(f.anchorId) : undefined;
    const bottom = f.y + f.height;
    const err = anc ? Math.abs(bottom - anc.baseline) : NaN;
    if (anc) worst = Math.max(worst, err);
    console.log(
      `   ${f.fieldType.padEnd(10)} ${f.partyRole.padEnd(12)} ${(f.anchorId ?? "-").padEnd(8)} ` +
      `${bottom.toFixed(1).padStart(12)} ${(anc ? anc.baseline.toFixed(1) : "-").padStart(15)} ` +
      `${(anc ? err.toFixed(1) : "-").padStart(7)}   ${f.snapped ? "yes" : "NO"}`,
    );
  }

  const snappedFields = a.suggestedFields.filter((f) => f.snapped);
  check("every field bound to a real anchor", snappedFields.length === a.suggestedFields.length,
        `${snappedFields.length}/${a.suggestedFields.length}`);
  check("no anchor claimed twice",
        new Set(snappedFields.map((f) => f.anchorId)).size === snappedFields.length);
  check("every field sits ON its line (bottom == baseline, <1pt)", worst < 1,
        `worst error ${worst.toFixed(2)}pt`);

  // x must match the rule, not the label
  const xOk = snappedFields.every((f) => {
    const anc = anchorById.get(f.anchorId!)!;
    return Math.abs(f.x - anc.x) < 0.5;
  });
  check("every field starts at the rule (not at the label)", xOk);

  // both parties got a signature, on the right blocks
  const sigs = a.suggestedFields.filter((f) => f.fieldType === "SIGNATURE");
  check("one SIGNATURE per party", sigs.length === 2,
        sigs.map((s) => s.partyRole).join(", "));
  const provider = sigs.find((s) => /provider/i.test(s.partyRole));
  const customer = sigs.find((s) => /customer/i.test(s.partyRole));
  check("Provider's signature is on the PROVIDER block (above the customer's)",
        !!provider && !!customer && provider.y < customer.y,
        provider && customer ? `provider y=${provider.y}, customer y=${customer.y}` : "missing");

  console.log(
    failures === 0
      ? `\n✅ ALL CHECKS PASSED — fields are bound to their real lines (worst error ${worst.toFixed(2)}pt).\n`
      : `\n❌ ${failures} CHECK(S) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("crashed:", e); process.exit(1); });

export {};
