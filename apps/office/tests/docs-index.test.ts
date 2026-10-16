// Indexes: XE and INDEX field instructions, building the index, and a round
// trip through .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseXE, xeInstr, parseIndexInstr, indexInstr, buildIndex, pagesText } from "../lib/docs/word-index";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

test("XE instructions", () => {
  assert.deepEqual(parseXE('XE "Apple"'), { entry: "Apple" });
  assert.deepEqual(parseXE(' XE "Fruit:Apple" \\b \\i '), { entry: "Fruit:Apple", bold: true, italic: true });
  assert.deepEqual(parseXE('XE "Pomme" \\t "Apple"'), { entry: "Pomme", see: "Apple" });
  assert.deepEqual(parseXE('XE "Say \\"hi\\""'), { entry: 'Say "hi"' });
  assert.equal(parseXE('XE ""'), null);
  assert.equal(parseXE("PAGE"), null);
  for (const a of [{ entry: "Fruit:Apple", bold: true }, { entry: 'Say "hi"', italic: true }, { entry: "Pomme", see: "Apple" }]) assert.deepEqual(parseXE(xeInstr(a)), a);
});

test("INDEX instructions", () => {
  assert.deepEqual(parseIndexInstr('INDEX \\h "A" \\c "2" \\z "1033"'), { columns: 2, rightAlign: false, headings: true });
  assert.deepEqual(parseIndexInstr('INDEX \\e "\t" \\c "3"'), { columns: 3, rightAlign: true, headings: false });
  assert.deepEqual(parseIndexInstr("INDEX"), { columns: 1, rightAlign: false, headings: false });
  for (const o of [{ columns: 2, rightAlign: true, headings: true }, { columns: 1, rightAlign: false, headings: false }]) assert.deepEqual(parseIndexInstr(indexInstr(o)), o);
});

test("building the index", () => {
  const g = buildIndex([
    { entry: "banana", page: "3" },
    { entry: "Apple", page: "10" },
    { entry: "apple", page: "2" },
    { entry: "Apple", page: "2", bold: true },
    { entry: "Fruit:Cherry", page: "4" },
    { entry: "Fruit:apple", page: "1" },
    { entry: "Fruit", page: "9" },
    { entry: "Pomme", page: "5", see: "Apple" },
    { entry: "3D printing", page: "7" },
    { entry: "Éclair", page: "8" },
  ]);
  assert.deepEqual(g.map((x) => x.letter), ["#", "A", "B", "E", "F", "P"]);
  const apple = g[1].items[0];
  assert.equal(apple.text, "Apple");
  assert.deepEqual(apple.pages, [{ label: "2", bold: true }, { label: "10" }], "a page listed plain and bold shows once, bold");
  const fruit = g[4].items[0];
  assert.deepEqual(fruit.subs.map((s) => s.text), ["apple", "Cherry"]);
  assert.equal(pagesText(fruit), "9");
  assert.equal(pagesText(g[5].items[0]), "See Apple");
  assert.equal(g[3].items[0].text, "Éclair");
});

test("index entries and the index round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Apples" }, { type: "indexEntry", attrs: { entry: "Apple", bold: true } }, { type: "text", text: " and pears" }, { type: "indexEntry", attrs: { entry: "Fruit:Pear" } }, { type: "text", text: "." }] },
      { type: "paragraph", content: [{ type: "text", text: "Pomme" }, { type: "indexEntry", attrs: { entry: "Pomme", see: "Apple" } }] },
      { type: "wordIndex", attrs: { columns: 2, rightAlign: true, headings: true } },
    ],
  };
  const bytes = await buildDocx({ doc, indexPages: ["1", "2", "2"] });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:instrText xml:space="preserve"> XE &quot;Apple&quot; \\b <\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="end"\/>/);
  assert.match(xml, /<w:instrText xml:space="preserve"> INDEX \\h &quot;A&quot; \\c &quot;2&quot; \\e &quot;\t&quot; \\z &quot;1033&quot; <\/w:instrText>/);
  assert.match(xml, /<w:pStyle w:val="IndexHeading"\/><\/w:pPr>.*<w:t>A<\/w:t>/);
  assert.match(xml, /<w:pStyle w:val="Index2"\/>.*<w:t xml:space="preserve">Pear<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t>2<\/w:t>/);
  assert.match(xml, /<w:r><w:rPr><w:b\/><\/w:rPr><w:t>1<\/w:t><\/w:r>/);
  assert.match(xml, /<w:i\/><\/w:rPr><w:t xml:space="preserve">See <\/w:t>/);
  const styles = await (await JSZip.loadAsync(bytes)).file("word/styles.xml")!.async("string");
  assert.match(styles, /w:styleId="Index1"/);
  const back = await importDocx(bytes);
  const p1 = back.doc.content![0].content!;
  assert.deepEqual(p1.map((n) => n.type), ["text", "indexEntry", "text", "indexEntry", "text"]);
  assert.equal(p1.map((n) => n.text || "").join(""), "Apples and pears.");
  assert.deepEqual(p1[1].attrs, { entry: "Apple", bold: true, italic: false, see: null });
  assert.deepEqual(back.doc.content![1].content![1].attrs, { entry: "Pomme", bold: false, italic: false, see: "Apple" });
  const idx = back.doc.content!.filter((n) => n.type === "wordIndex");
  assert.equal(idx.length, 1);
  assert.deepEqual(idx[0].attrs, { columns: 2, rightAlign: true, headings: true });
  assert.ok(!JSON.stringify(back.doc).includes("IndexHeading"), "the index's text is not imported as paragraphs");
  assert.equal(back.doc.content!.length, 3);
});
