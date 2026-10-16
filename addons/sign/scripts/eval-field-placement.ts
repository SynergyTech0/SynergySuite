/**
 * Field-placement evaluation against the LIVE AI model, on documents whose correct box positions we
 * know exactly because we draw them ourselves.
 *
 *   AI_API_KEY=... AI_MODEL=... npx tsx scripts/eval-field-placement.ts
 *
 * Four documents, one per way real contracts mark "sign here":
 *   A. typed underscores        "Signature: ____________"
 *   B. drawn lines              a vector line with a "Signature" caption under it (Word/Google Docs exports)
 *   C. a form                   outlined boxes to fill in, a checkbox square, a drawn signature line
 *   D. a scan                   document B rasterised into an image-only PDF (no text layer at all)
 *
 * A field on a LINE is right when its bottom edge rests on the line (within TOL_LINE pt) and it
 * starts within the line's span. A field for a BOX is right when it overlaps the box (IoU >= 0.6).
 * Prints a per-field table and a scorecard; exits 1 if any document scores below its bar.
 */


const H = 792; // Letter page height; pdf-lib draws bottom-left, the app stores top-left
const TOL_LINE = 3;

type Truth =
  | { kind: "line"; type: string; party: string; x0: number; x1: number; y: number; page: number }
  | { kind: "box"; type: string; party: string; x: number; y: number; w: number; h: number; page: number };

async function build() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const black = rgb(0, 0, 0);

  // ---------- A: typed underscores ----------
  const A = await PDFDocument.create();
  {
    const p = A.addPage([612, H]);
    const f = await A.embedFont(StandardFonts.Helvetica), b = await A.embedFont(StandardFonts.HelveticaBold);
    const T = (t: string, x: number, y: number, s = 11, font = f) => p.drawText(t, { x, y, size: s, font, color: black });
    T("SERVICES AGREEMENT", 72, 730, 16, b);
    T('Between Orion Freight Co. (the "Provider") and Lena Ortiz (the "Customer"),', 72, 700);
    T("effective May 1, 2026, governed by the laws of Texas.", 72, 684);
    T("PROVIDER:", 72, 300, 11, b); T("Signature: ______________________________", 72, 280); T("Date: ____________________", 72, 258);
    T("CUSTOMER:", 72, 200, 11, b); T("Signature: ______________________________", 72, 180); T("Date: ____________________", 72, 158);
  }
  // Underscore truth: the rule sits on the text baseline. x0 is where the underscores start.
  const fA = await A.embedFont(StandardFonts.Helvetica);
  const sx = (label: string) => 72 + fA.widthOfTextAtSize(label, 11);
  const truthA: Truth[] = [
    { kind: "line", type: "SIGNATURE", party: "provider", x0: sx("Signature: "), x1: sx("Signature: ______________________________"), y: H - 280, page: 1 },
    { kind: "line", type: "DATE", party: "provider", x0: sx("Date: "), x1: sx("Date: ____________________"), y: H - 258, page: 1 },
    { kind: "line", type: "SIGNATURE", party: "customer", x0: sx("Signature: "), x1: sx("Signature: ______________________________"), y: H - 180, page: 1 },
    { kind: "line", type: "DATE", party: "customer", x0: sx("Date: "), x1: sx("Date: ____________________"), y: H - 158, page: 1 },
  ];

  // ---------- B: drawn lines with captions underneath ----------
  const B = await PDFDocument.create();
  const truthB: Truth[] = [];
  {
    const p = B.addPage([612, H]);
    const f = await B.embedFont(StandardFonts.TimesRoman), b = await B.embedFont(StandardFonts.TimesRomanBold);
    const T = (t: string, x: number, y: number, s = 11, font = f) => p.drawText(t, { x, y, size: s, font, color: black });
    T("MUTUAL NON-DISCLOSURE AGREEMENT", 72, 730, 15, b);
    T('This Agreement is made between Acme Robotics, Inc. ("Company") and Priya Shah ("Recipient").', 72, 700);
    T("The parties agree to keep each other's confidential information secret for three years.", 72, 684);
    T("This Agreement is governed by the laws of the State of New York.", 72, 668);
    const line = (x0: number, x1: number, y: number) => p.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.75, color: black });
    const block = (title: string, party: string, top: number) => {
      T(title, 72, top, 11, b);
      line(72, 300, top - 40); T("Signature", 72, top - 52, 9);
      line(330, 470, top - 40); T("Date", 330, top - 52, 9);
      line(72, 300, top - 80); T("Printed name", 72, top - 92, 9);
      truthB.push({ kind: "line", type: "SIGNATURE", party, x0: 72, x1: 300, y: H - (top - 40), page: 1 });
      truthB.push({ kind: "line", type: "DATE", party, x0: 330, x1: 470, y: H - (top - 40), page: 1 });
      truthB.push({ kind: "line", type: "TEXT", party, x0: 72, x1: 300, y: H - (top - 80), page: 1 });
    };
    block("COMPANY: Acme Robotics, Inc.", "company", 420);
    block("RECIPIENT: Priya Shah", "recipient", 280);
  }

  // ---------- C: a form with boxes, a checkbox and a drawn signature line ----------
  const C = await PDFDocument.create();
  const truthC: Truth[] = [];
  {
    const p = C.addPage([612, H]);
    const f = await C.embedFont(StandardFonts.Helvetica), b = await C.embedFont(StandardFonts.HelveticaBold);
    const T = (t: string, x: number, y: number, s = 10, font = f) => p.drawText(t, { x, y, size: s, font, color: black });
    T("VOLUNTEER WAIVER AND RELEASE", 72, 730, 15, b);
    T("Riverside Community Garden (the \"Organization\"). To be completed by the participant.", 72, 706);
    const box = (x: number, yBottom: number, w: number, h: number) => p.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: black, borderWidth: 0.8 });
    T("Full legal name", 72, 662); box(72, 632, 300, 24);
    truthC.push({ kind: "box", type: "TEXT", party: "participant", x: 72, y: H - 656, w: 300, h: 24, page: 1 });
    T("Email address", 72, 612); box(72, 582, 300, 24);
    truthC.push({ kind: "box", type: "TEXT", party: "participant", x: 72, y: H - 606, w: 300, h: 24, page: 1 });
    box(72, 540, 12, 12); T("I have read and agree to the release terms above.", 92, 542);
    truthC.push({ kind: "box", type: "CHECKBOX", party: "participant", x: 72, y: H - 552, w: 12, h: 12, page: 1 });
    p.drawLine({ start: { x: 72, y: 470 }, end: { x: 320, y: 470 }, thickness: 0.8, color: black }); T("Participant signature", 72, 458, 9);
    truthC.push({ kind: "line", type: "SIGNATURE", party: "participant", x0: 72, x1: 320, y: H - 470, page: 1 });
    T("Date", 360, 492); box(360, 462, 140, 24);
    truthC.push({ kind: "box", type: "DATE", party: "participant", x: 360, y: H - 486, w: 140, h: 24, page: 1 });
  }

  const pdfA = Buffer.from(await A.save()), pdfB = Buffer.from(await B.save()), pdfC = Buffer.from(await C.save());

  // ---------- D: document B as a scan (image only, no text layer) ----------
  const pdfD = await rasterise(pdfB);
  return [
    { name: "A typed underscores", pdf: pdfA, truth: truthA, bar: 1.0 },
    { name: "B drawn lines", pdf: pdfB, truth: truthB, bar: 1.0 },
    { name: "C form boxes", pdf: pdfC, truth: truthC, bar: 1.0 },
    { name: "D scanned (image only)", pdf: pdfD, truth: truthB, bar: 0.8 },
  ];
}

async function rasterise(pdf: Buffer): Promise<Buffer> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { PDFDocument } = await import("pdf-lib");
  const path = await import("path");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false,
    standardFontDataUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
  }).promise;
  const out = await PDFDocument.create();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const scale = 150 / 72;
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as any, viewport: vp }).promise;
    const png = await out.embedPng(canvas.toBuffer("image/png"));
    const base = page.getViewport({ scale: 1 });
    const p = out.addPage([base.width, base.height]);
    p.drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
  }
  return Buffer.from(await out.save());
}

const iou = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

function score(fields: any[], truth: Truth[]) {
  const used = new Set<number>();
  const rows: string[] = [];
  let correct = 0;
  for (const t of truth) {
    let best = -1, bestErr = Infinity, bestOk = false, desc = "MISSING";
    fields.forEach((f, i) => {
      if (used.has(i) || f.pageNumber !== t.page) return;
      if (t.kind === "line") {
        const err = Math.abs(f.y + f.height - t.y);
        const startsOn = f.x >= t.x0 - 6 && f.x <= t.x1 - 10;
        if (err < bestErr && startsOn) { best = i; bestErr = err; bestOk = err <= TOL_LINE; desc = `bottom off ${err.toFixed(1)}pt`; }
      } else {
        const o = iou({ x: f.x, y: f.y, w: f.width, h: f.height }, t);
        const err = 1 - o;
        if (o > 0.05 && err < bestErr) { best = i; bestErr = err; bestOk = o >= 0.6; desc = `IoU ${o.toFixed(2)}`; }
      }
    });
    if (best >= 0) used.add(best);
    const f = best >= 0 ? fields[best] : null;
    const partyOk = f ? new RegExp(t.party, "i").test(f.partyRole) : false;
    const ok = bestOk && partyOk;
    if (ok) correct++;
    rows.push(`   ${ok ? "OK  " : "MISS"} ${t.type.padEnd(9)} ${t.party.padEnd(12)} ${desc.padEnd(20)} ${f ? `party=${f.partyRole} snapped=${f.snapped ? "yes" : "no"}` : ""}`);
  }
  const extra = fields.length - used.size;
  return { correct, total: truth.length, extra, rows };
}

async function main() {
  const { analyzeDocument } = await import("../lib/ai/analyze");
  const { AI_MODEL } = await import("../lib/ai/client");
  console.log(`model: ${AI_MODEL}`);
  const docs = await build();
  let failed = 0;
  const summary: string[] = [];
  for (const d of docs) {
    console.log(`\n=== ${d.name}`);
    let fields: any[] = [];
    try {
      const t0 = Date.now();
      const a = await analyzeDocument(d.pdf);
      fields = a.suggestedFields;
      console.log(`   ${fields.length} fields in ${((Date.now() - t0) / 1000).toFixed(1)}s; parties: ${a.parties.map((p: any) => p.role).join(", ")}`);
      if (process.env.EVAL_VERBOSE) console.log(`   title="${a.title}" parties=${JSON.stringify(a.parties.map((p: any) => ({ role: p.role, evidence: p.evidence })))}`);
    } catch (e: any) {
      console.log(`   analysis failed: ${e.message}`);
    }
    const s = score(fields, d.truth);
    s.rows.forEach(r => console.log(r));
    const rate = s.correct / s.total;
    summary.push(`${d.name.padEnd(26)} ${s.correct}/${s.total} correct, ${s.extra} extra`);
    if (rate < d.bar || s.extra > 0) failed++;
  }
  console.log("\nSCORECARD\n" + summary.map(s => "  " + s).join("\n"));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("crashed:", e); process.exit(1); });

export {};
