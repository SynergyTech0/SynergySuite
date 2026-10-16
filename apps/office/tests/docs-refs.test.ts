// Captions (SEQ), bookmarks and cross-references (REF/PAGEREF): numbering,
// reference text, and the round trip through .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { fieldIndex, refText, parseFieldInstr, seqText } from "../lib/docs/fields";
import type { PMNode } from "../lib/docs/model";

const caption = (label: string, bm: string, text: string): PMNode => ({
  type: "paragraph",
  attrs: { styleId: "Caption" },
  content: [{ type: "bookmark", attrs: { name: bm, span: "label" } }, { type: "text", text: `${label} ` }, { type: "seqField", attrs: { name: label } }, { type: "text", text: `: ${text}` }],
});
const xref = (target: string, show: string): PMNode => ({ type: "crossRef", attrs: { target, show, link: true } });

const doc: PMNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "bookmark", attrs: { name: "_Ref100000001", span: "para" } }, { type: "text", text: "Results" }] },
    { type: "paragraph", content: [{ type: "text", text: "See " }, xref("_Ref200000002", "text"), { type: "text", text: " on page " }, xref("_Ref200000002", "page"), { type: "text", text: ", shown " }, xref("_Ref200000002", "above"), { type: "text", text: ", and " }, xref("Summary", "text"), { type: "text", text: "." }] },
    caption("Figure", "_Ref200000001", "Revenue"),
    caption("Table", "_Ref300000001", "Costs"),
    caption("Figure", "_Ref200000002", "Margin"),
    { type: "paragraph", content: [{ type: "bookmark", attrs: { name: "Summary", span: "para" } }, { type: "text", text: "Totals up." }] },
    { type: "tableOfContents", attrs: { levels: 1, title: null, caption: "Figure" } },
  ],
};

test("captions number per label in document order; references show text, number and above/below", () => {
  const ix = fieldIndex(doc as never);
  assert.deepEqual(ix.captions.map((c) => `${c.label} ${c.number}`), ["Figure 1", "Table 1", "Figure 2"]);
  assert.equal(ix.captions[2].text, "Figure 2: Margin");
  assert.equal(refText(ix, "_Ref200000002", "text"), "Figure 2");
  assert.equal(refText(ix, "_Ref200000002", "number"), "2");
  assert.equal(refText(ix, "_Ref100000001", "text"), "Results");
  assert.equal(refText(ix, "Summary", "text"), "Totals up.");
  assert.equal(refText(ix, "missing", "text"), "Error! Reference source not found.");
  assert.equal(refText(ix, "_Ref200000002", "above", { refPos: 0 }), "below");
  assert.equal(seqText(4, "ROMAN"), "IV");
  assert.equal(seqText(28, "alphabetic"), "ab");
});

test("field instructions parse like Word's", () => {
  assert.deepEqual(parseFieldInstr(" SEQ Figure \\* ARABIC "), { kind: "SEQ", name: "Figure", show: "text", format: "ARABIC", link: false });
  assert.equal(parseFieldInstr(" PAGEREF _Ref123 \\h ")!.show, "page");
  assert.equal(parseFieldInstr(" REF _Ref123 \\p \\h ")!.show, "above");
  assert.equal(parseFieldInstr(" REF _Ref123 \\r \\h ")!.show, "number");
  assert.equal(parseFieldInstr(' REF "My_Mark" \\h ')!.name, "My_Mark");
  assert.equal(parseFieldInstr(" HYPERLINK x "), null);
});

test("captions, bookmarks and cross-references round-trip through .docx", async () => {
  const bytes = await buildDocx({ doc, bookmarkPages: { _Ref200000002: "3" } });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  // the caption's bookmark wraps "Figure 2"
  assert.match(main, /<w:bookmarkStart w:id="\d+" w:name="_Ref200000002"\/><w:r><w:t xml:space="preserve">Figure <\/w:t><\/w:r>.*?SEQ Figure \\\* ARABIC .*?<w:t xml:space="preserve">2<\/w:t>.*?<w:fldChar w:fldCharType="end"\/><\/w:r><w:bookmarkEnd w:id="\d+"\/>/);
  assert.match(main, / REF _Ref200000002 \\h <\/w:instrText>.*?<w:t xml:space="preserve">Figure 2<\/w:t>/);
  assert.match(main, / PAGEREF _Ref200000002 \\h <\/w:instrText>.*?<w:t xml:space="preserve">3<\/w:t>/);
  assert.match(main, / REF _Ref200000002 \\p \\h <\/w:instrText>.*?<w:t xml:space="preserve">below<\/w:t>/);
  assert.match(main, /TOC \\h \\z \\c "Figure"/);
  assert.match(main, /<w:pStyle w:val="TableofFigures"\/>/);
  assert.match(await zip.file("word/styles.xml")!.async("string"), /w:styleId="Caption"><w:name w:val="caption"\/>/);

  const back = await importDocx(bytes);
  const ix = fieldIndex(back.doc as never);
  assert.deepEqual(ix.captions.map((c) => `${c.label} ${c.number}`), ["Figure 1", "Table 1", "Figure 2"]);
  assert.equal(ix.bookmarks.get("_Ref200000002")?.span, "label");
  assert.equal(ix.bookmarks.get("Summary")?.span, "para");
  const refs: PMNode[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "crossRef") refs.push(n);
    n.content?.forEach(walk);
  };
  walk(back.doc);
  assert.deepEqual(refs.map((r) => [r.attrs?.target, r.attrs?.show]), [["_Ref200000002", "text"], ["_Ref200000002", "page"], ["_Ref200000002", "above"], ["Summary", "text"]]);
  // the cached field results are not imported as text as well
  const para = back.doc.content![1];
  assert.equal(para.content!.filter((n) => n.type === "text").map((n) => n.text).join(""), "See  on page , shown , and .");
  assert.ok(back.doc.content!.some((n) => n.type === "tableOfContents" && n.attrs?.caption === "Figure"));
});
