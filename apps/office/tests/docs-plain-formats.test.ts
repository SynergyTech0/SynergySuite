// .txt and .md open and save, Word templates (.dotx) and macro-enabled files (.docm).
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { textToDoc, docToText, markdownToDoc, docToMarkdown, asTemplate, asPlainDocument, packageKind, fileKind } from "../lib/docs/plain-formats";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

test("plain text in and out", () => {
  const d = textToDoc("\uFEFFone\r\ntwo\tcols\r\n\r\nfour\fnext page\n");
  assert.deepEqual(d.content!.map((n) => n.type), ["paragraph", "paragraph", "paragraph", "paragraph", "pageBreak", "paragraph"]);
  assert.equal(d.content![1].content![0].text, "two\tcols");
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "inner" }] }] }] }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }] }] }] },
    ],
  };
  assert.equal(docToText(doc), "Title\n3. a\n4. b\n    • inner\nx\ty");
});

test("markdown in", () => {
  const md = [
    "# Heading *one*",
    "",
    "Some **bold**, _italic_, ~~gone~~, `code` and a [link](https://example.com) plus [ref][r].",
    "",
    "[r]: https://ref.example",
    "",
    "- item",
    "  - nested",
    "- [x] not a task in a plain list",
    "",
    "5. five",
    "6. six",
    "",
    "- [ ] todo",
    "- [x] done",
    "",
    "> quoted",
    "",
    "```js",
    "let x = 1;",
    "```",
    "",
    "| A | B |",
    "|:-|:-:|",
    "| 1 | 2 |",
    "",
    "![alt](https://example.com/i.png)",
    "",
    "---",
  ].join("\n");
  const d = markdownToDoc(md).content!;
  const types = d.map((n) => n.type);
  // a list with any [x] item is a task list
  assert.deepEqual(types, ["heading", "paragraph", "taskList", "orderedList", "taskList", "blockquote", "codeBlock", "table", "image", "horizontalRule"]);
  assert.equal(d[0].attrs?.level, 1);
  assert.deepEqual(d[0].content![1].marks, [{ type: "italic" }]);
  const p = d[1].content!;
  assert.ok(p.some((n) => n.text === "bold" && n.marks?.[0].type === "bold"));
  assert.ok(p.some((n) => n.text === "gone" && n.marks?.[0].type === "strike"));
  assert.ok(p.some((n) => n.text === "code" && n.marks?.[0].type === "code"));
  assert.ok(p.some((n) => n.text === "ref" && n.marks?.[0].attrs?.href === "https://ref.example"));
  const ol = d.find((n) => n.type === "orderedList")!;
  assert.equal(ol.attrs?.start, 5);
  const tasks = d.filter((n) => n.type === "taskList").at(-1)!;
  assert.deepEqual(tasks.content!.map((i) => i.attrs?.checked), [false, true]);
  assert.equal(d.find((n) => n.type === "codeBlock")!.attrs?.language, "js");
  const t = d.find((n) => n.type === "table")!;
  assert.equal(t.content![0].content![0].type, "tableHeader");
  assert.equal(t.content![1].content![1].content![0].attrs?.textAlign, "center");
});

test("markdown out and back", () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
      { type: "paragraph", content: [{ type: "text", text: "Use " }, { type: "text", text: "bold", marks: [{ type: "bold" }] }, { type: "text", text: " and " }, { type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] }, { type: "text", text: " or " }, { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://a.b/c d" } }] }, { type: "text", text: " 2*3 #1" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
      { type: "codeBlock", attrs: { language: "py" }, content: [{ type: "text", text: "print(1)" }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a|b" }] }] }] }] },
    ],
  };
  const md = docToMarkdown(doc);
  assert.match(md, /^## Plan\n\nUse \*\*bold\*\* and \*\*\*both\*\*\* or \[site\]\(https:\/\/a\.b\/c%20d\) 2\\\*3 \\#1\n\n- a\n  1\. b\n\n\* \[x\] done\n\n```py\nprint\(1\)\n```\n\n\| H \|\n\| --- \|\n\| a\\\|b \|\n$/);
  const back = markdownToDoc(md).content!;
  assert.deepEqual(back.map((n) => n.type), ["heading", "paragraph", "bulletList", "taskList", "codeBlock", "table"]);
  const para = back[1].content!;
  assert.equal(para.map((n) => n.text).join(""), "Use bold and both or site 2*3 #1");
  assert.equal(back[5].content![1].content![0].content![0].content![0].text, "a|b");
});

test("templates and macro-enabled packages", async () => {
  const docx = await buildDocx({ doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Letterhead" }] }] } });
  assert.equal(await packageKind(docx), "document");
  const dotx = await asTemplate(docx);
  assert.equal(await packageKind(dotx), "template");
  // a .docm: macro-enabled main part and a VBA project
  const zip = await JSZip.loadAsync(docx);
  let ct = await zip.file("[Content_Types].xml")!.async("string");
  ct = ct.replace("wordprocessingml.document.main+xml", "x").replace('ContentType="application/vnd.openxmlformats-officedocument.x"', 'ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"');
  ct = ct.replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  zip.file("[Content_Types].xml", ct);
  zip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  zip.file("word/_rels/document.xml.rels", rels.replace("</Relationships>", '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
  const docm = await zip.generateAsync({ type: "uint8array" });
  assert.equal(await packageKind(docm), "macroDocument");
  const plain = await asPlainDocument(docm);
  assert.equal(plain.hadMacros, true);
  assert.equal(await packageKind(plain.bytes), "document");
  const z2 = await JSZip.loadAsync(plain.bytes);
  assert.equal(z2.file("word/vbaProject.bin"), null);
  assert.doesNotMatch(await z2.file("word/_rels/document.xml.rels")!.async("string"), /vbaProject/);
  assert.equal((await importDocx(plain.bytes)).doc.content![0].content![0].text, "Letterhead");
  assert.equal((await importDocx((await asPlainDocument(dotx)).bytes)).doc.content![0].content![0].text, "Letterhead");
  const head = (b: Uint8Array) => b.subarray(0, 96);
  assert.equal(fileKind("a.dotx", head(dotx)), "docx");
  assert.equal(fileKind("notes.md", new Uint8Array([35])), "md");
  assert.equal(fileKind("x.txt", new Uint8Array([65])), "txt");
  assert.equal(fileKind("x.rtf", new TextEncoder().encode("{\\rtf1")), "convert");
});
