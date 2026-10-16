/** Prove the final signed PDF really contains the burned-in signatures + dates. */
import fs from "fs";

async function main() {
  const file = process.argv[2];
  const b = fs.readFileSync(file);

  const { PDFDocument } = await import("pdf-lib");
  const { extractLayout } = await import("../lib/ai/extract");

  const doc = await PDFDocument.load(b, { updateMetadata: false });
  console.log("bytes:                ", b.length);
  console.log("pages:                ", doc.getPageCount());
  console.log("Producer:             ", doc.getProducer());

  const layout = await extractLayout(b);
  const hits = layout.pages[0].runs.filter((r) => r.text.includes("2026-03-01"));
  console.log("original text intact: ", layout.text.includes("NON-DISCLOSURE"));
  console.log("dates burned in:      ", hits.length);
  for (const h of hits) console.log(`   "${h.text}" at (${h.x}, ${h.y})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
