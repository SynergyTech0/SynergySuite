// Footnotes and endnotes: numbering, and the round trip through .docx
// (footnotes.xml / endnotes.xml with Word's separator notes).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { notesOf, parseNote } from "../components/docs/notes";
import type { PMNode } from "../lib/docs/model";

const note = (kind: string, text: string, bold = false): PMNode => ({
  type: "noteRef",
  attrs: { kind, content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) }] }] }) },
});

const doc: PMNode = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "First claim" }, note("footnote", "Source one."), { type: "text", text: " and second" }, note("footnote", "Source two.", true)] },
    { type: "paragraph", attrs: { keepLines: true }, content: [{ type: "text", text: "An aside" }, note("endnote", "Later remark.")] },
  ],
};

test("notes are numbered per kind in document order", () => {
  const n = notesOf(doc);
  assert.deepEqual(n.map((x) => [x.kind, x.label]), [["footnote", "1"], ["footnote", "2"], ["endnote", "i"]]);
  assert.equal(parseNote(n[1].content).content![0].content![0].text, "Source two.");
});

test("footnotes and endnotes round-trip through .docx", async () => {
  const bytes = await buildDocx({ doc });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  assert.match(main, /<w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference w:id="2"\/>/);
  assert.match(main, /<w:endnoteReference w:id="1"\/>/);
  assert.match(main, /<w:keepLines\/>/);
  const fn = await zip.file("word/footnotes.xml")!.async("string");
  assert.match(fn, /<w:footnote w:type="separator" w:id="-1">/);
  assert.match(fn, /<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"\/>.*?<w:footnoteRef\/>.*?Source one\./);
  assert.ok(await zip.file("word/endnotes.xml"));
  assert.match(await zip.file("word/settings.xml")!.async("string"), /<w:footnotePr><w:footnote w:id="-1"\/><w:footnote w:id="0"\/><\/w:footnotePr><w:endnotePr>/);
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /footnotes\+xml.*endnotes\+xml/);
  assert.match(await zip.file("word/styles.xml")!.async("string"), /w:styleId="FootnoteReference"><w:name w:val="footnote reference"\/>.*?<w:vertAlign w:val="superscript"\/>/);

  const back = await importDocx(bytes);
  const n = notesOf(back.doc);
  assert.deepEqual(n.map((x) => x.kind), ["footnote", "footnote", "endnote"]);
  const second = parseNote(n[1].content);
  assert.equal(second.content![0].content![0].text, "Source two.");
  assert.ok(second.content![0].content![0].marks?.some((m) => m.type === "bold"));
  assert.equal(second.content![0].attrs?.styleId ?? null, null);
  assert.equal(parseNote(n[2].content).content![0].content![0].text, "Later remark.");
  assert.equal(back.doc.content![1].attrs?.keepLines, true);
  assert.equal(back.doc.content![0].content!.map((c) => c.text ?? `[${c.type}]`).join(""), "First claim[noteRef] and second[noteRef]");
});
