// Other word-processor formats through LibreOffice: format sniffing, and
// .docx -> .odt / .rtf -> .docx keeping the text (skipped without soffice).
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLocally, localOffice, sniffFormat } from "../lib/office-convert";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";

test("files are recognised by their bytes", async () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.equal(sniffFormat(enc("{\\rtf1\\ansi hello}")), "rtf");
  assert.equal(sniffFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])), "doc");
  const odtHead = new Uint8Array(120);
  odtHead.set([0x50, 0x4b, 3, 4]);
  odtHead.set(enc("mimetypeapplication/vnd.oasis.opendocument.text"), 30);
  assert.equal(sniffFormat(odtHead), "odt");
  const docx = await buildDocx({ doc: { type: "doc", content: [{ type: "paragraph" }] }, styles: [] });
  assert.equal(sniffFormat(docx), "docx");
  assert.equal(sniffFormat(enc("<html>")), null);
});

const bin = localOffice();
test("a document survives .odt and .rtf", { skip: !bin && "LibreOffice not installed", timeout: 240000 }, async () => {
  const docx = await buildDocx({
    doc: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Report title" }] }, { type: "paragraph", content: [{ type: "text", text: "Some " }, { type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "text", text: " text." }] }] },
    styles: [],
  });
  for (const fmt of ["odt", "rtf"] as const) {
    const other = await convertLocally(bin!, docx, "docx", fmt);
    assert.equal(sniffFormat(other), fmt);
    const back = await importDocx(await convertLocally(bin!, other, fmt, "docx"));
    const text = JSON.stringify(back.doc);
    assert.match(text, /Report title/, fmt);
    assert.match(text, /"text":"bold","marks":\[[^\]]*"bold"/, fmt);
  }
});
