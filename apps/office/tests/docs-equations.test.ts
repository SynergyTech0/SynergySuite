// Equations: inline and display equations save as Office Math (m:oMath,
// m:oMathPara) and come back as the same LaTeX.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

test("inline and display equations round-trip through .docx as OMML", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Area is " }, { type: "equation", attrs: { latex: "A=\\pi r^{2}", display: false } }, { type: "text", text: " here." }] },
      { type: "paragraph", content: [{ type: "equation", attrs: { latex: "x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}", display: true } }] },
    ],
  };
  const bytes = await buildDocx({ doc });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  assert.match(main, /xmlns:m="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math"/);
  assert.match(main, /<w:t xml:space="preserve">Area is <\/w:t><\/w:r><m:oMath><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"\/><\/w:rPr><m:t>A<\/m:t>/);
  assert.match(main, /<w:p><m:oMathPara><m:oMathParaPr><m:jc m:val="centerGroup"\/><\/m:oMathParaPr><m:oMath>.*?<m:f>.*?<m:rad>/);
  const back = await importDocx(bytes);
  const eqs: PMNode[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "equation") eqs.push(n);
    n.content?.forEach(walk);
  };
  walk(back.doc);
  // the LaTeX comes back normalised (single-character groups lose their braces)
  assert.deepEqual(eqs.map((e) => [e.attrs!.latex, e.attrs!.display]), [["A=\\pi r^2", false], ["x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", true]]);
  assert.deepEqual(back.doc.content![0].content!.map((n) => n.type), ["text", "equation", "text"]);
});
