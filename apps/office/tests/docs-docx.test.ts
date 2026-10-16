// Docs .docx round trip: a rich document written by buildDocx reads back
// through importDocx with its styles, run and paragraph formatting, lists,
// tables, images, links, breaks, sections, headers/footers, comments and TOC.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx, IMPORTED_THREAD } from "../lib/docs/docx-import";
import { type PMNode, type Section, defaultSection, parseSection, mergeStyles, resolveStyle, stylesCss } from "../lib/docs/model";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const t = (text: string, marks?: PMNode["marks"]): PMNode => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (content: PMNode[] | string, attrs: Record<string, unknown> = {}): PMNode => ({ type: "paragraph", attrs, content: typeof content === "string" ? [t(content)] : content });
const li = (...c: PMNode[]): PMNode => ({ type: "listItem", content: c });
const cell = (text: string, attrs: Record<string, unknown> = {}, type = "tableCell"): PMNode => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [p(text)] });

function walk(n: PMNode, f: (n: PMNode) => void) {
  f(n);
  n.content?.forEach((c) => walk(c, f));
}
function all(n: PMNode, type: string): PMNode[] {
  const out: PMNode[] = [];
  walk(n, (x) => x.type === type && out.push(x));
  return out;
}
const text = (n: PMNode): string => (n.type === "text" ? n.text || "" : (n.content || []).map(text).join(""));
const findText = (doc: PMNode, s: string) => {
  let hit: PMNode | undefined;
  walk(doc, (x) => {
    if (!hit && x.type === "text" && x.text?.includes(s)) hit = x;
  });
  return hit;
};
const mark = (n: PMNode | undefined, type: string) => n?.marks?.find((m) => m.type === type);

function richDoc(): { doc: PMNode; body: Section; firstSection: Section } {
  const header: PMNode = { type: "doc", content: [p([t("Report header ")], { textAlign: "right" })] };
  const footer: PMNode = { type: "doc", content: [p([t("Page "), { type: "pageField", attrs: { kind: "page" } }, t(" of "), { type: "pageField", attrs: { kind: "pages" } }], { textAlign: "center" })] };
  const firstHeader: PMNode = { type: "doc", content: [p("First page header")] };
  const firstSection: Section = { ...defaultSection(), pageWidth: 595.3, pageHeight: 841.9, margins: { top: 54, right: 54, bottom: 54, left: 54, header: 30, footer: 30 }, titlePage: true, headers: { default: header, first: firstHeader }, footers: { default: footer } };
  const body: Section = { ...defaultSection(), type: "nextPage", orientation: "landscape", pageWidth: 792, pageHeight: 612, columns: { count: 2, space: 24, separator: true }, footers: { default: footer, even: { type: "doc", content: [p("Even footer")] } } };
  const doc: PMNode = {
    type: "doc",
    content: [
      { type: "tableOfContents", attrs: { levels: 3, title: "Contents" } },
      p("Quarterly report", { styleId: "Title" }),
      { type: "heading", attrs: { level: 1 }, content: [t("Introduction")] },
      p([
        t("Bold", [{ type: "bold" }]),
        t(" and "),
        t("red Georgia 14", [{ type: "textStyle", attrs: { fontFamily: "Georgia, serif", fontSize: "14pt", color: "#ff0000" } }]),
        t(" and "),
        t("highlighted", [{ type: "highlight", attrs: { color: "#ffff00" } }]),
        t(" and "),
        t("custom shade", [{ type: "highlight", attrs: { color: "#ffd8b1" } }]),
        t(" "),
        t("H", []),
        t("2", [{ type: "subscript" }]),
        t("O "),
        t("link", [{ type: "link", attrs: { href: "https://example.com/a?b=1&c=2" } }]),
        t(" "),
        t("commented", [{ type: "comment", attrs: { threadId: "th1" } }]),
        t(" "),
        t("styled", [{ type: "textStyle", attrs: { charStyle: "Accent" } }]),
      ], { spaceBefore: 6, spaceAfter: 12, lineHeight: "1.5", indLeft: 36, indRight: 18, indFirst: -18, textAlign: "justify" }),
      { type: "heading", attrs: { level: 2 }, content: [t("Lists")] },
      {
        type: "orderedList",
        attrs: { start: 1, numFmt: "decimal" },
        content: [
          li(p("One"), { type: "orderedList", attrs: { start: 1, numFmt: "lowerLetter" }, content: [li(p("One-a"), { type: "bulletList", attrs: { bullet: "square" }, content: [li(p("deep"))] }), li(p("One-b"))] }),
          li(p("Two")),
        ],
      },
      p("between"),
      { type: "bulletList", content: [li(p("Bullet A")), li(p("Bullet B"))] },
      { type: "orderedList", attrs: { start: 4, numFmt: "upperRoman" }, content: [li(p("Four")), li(p("Five"))] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [cell("H1", { colwidth: [120] }, "tableHeader"), cell("H2", { colwidth: [160] }, "tableHeader"), cell("H3", { colwidth: [100] }, "tableHeader")] },
          { type: "tableRow", content: [cell("merged across", { colspan: 2, background: "#d9e2f3", colwidth: [120, 160] }), cell("tall", { rowspan: 2, valign: "middle", borders: JSON.stringify({ top: "2px solid #ff0000", right: "1px dashed #00ff00", bottom: "none", left: "1px solid #000000" }) })] },
          { type: "tableRow", content: [cell("a"), cell("b")] },
        ],
      },
      { type: "image", attrs: { src: PNG, alt: "red dot", width: 64, height: 32, align: "center" } },
      { type: "pageBreak" },
      { type: "heading", attrs: { level: 3 }, content: [t("After the break")] },
      p("Custom paragraph", { styleId: "MyPara" }),
      { type: "sectionBreak", attrs: { section: JSON.stringify(firstSection) } },
      p("Second section text"),
      { type: "codeBlock", attrs: { language: null }, content: [t("let x = 1;\nlet y = 2;")] },
      { type: "horizontalRule" },
      { type: "blockquote", content: [p("quoted")] },
    ],
  };
  return { doc, body, firstSection };
}

const STYLES = [
  { id: "MyPara", name: "My Para", type: "paragraph" as const, basedOn: "Normal", gallery: true, run: { font: "Georgia", size: 13, color: "#336699", bold: true }, para: { spaceAfter: 20, indentLeft: 10, align: "center" as const } },
  { id: "Accent", name: "Accent", type: "character" as const, gallery: true, run: { color: "#c00000", italic: true } },
  { id: "Normal", name: "Normal", type: "paragraph" as const, builtin: true, gallery: true, run: { font: "Cambria", size: 12 }, para: { spaceAfter: 6, lineHeight: "1.15" } },
  { id: "Heading1", name: "Heading 1", type: "paragraph" as const, builtin: true, gallery: true, basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 20, color: "#123456" }, para: { spaceBefore: 18, spaceAfter: 6, keepNext: true } },
];

test("a rich document round-trips through .docx", async () => {
  const { doc, body } = richDoc();
  const bytes = await buildDocx({
    doc,
    body,
    styles: STYLES,
    settings: { evenAndOddHeaders: true },
    comments: [{ id: "th1", resolved: true, messages: [{ author: "Ada Lovelace", date: Date.UTC(2026, 0, 2), body: "Check this" }, { author: "Bob", body: "Done" }] }],
    title: "Report",
    headingPages: [1, 1, 2],
  });
  const back = await importDocx(bytes);
  const d = back.doc;

  // styles
  const styles = mergeStyles(back.styles);
  const my = resolveStyle(styles, "MyPara");
  assert.equal(my.run.font, "Georgia");
  assert.equal(my.run.size, 13);
  assert.equal(my.run.color, "#336699");
  assert.equal(my.run.bold, true);
  assert.equal(my.para.spaceAfter, 20);
  assert.equal(my.para.align, "center");
  assert.equal(styles.find((s) => s.id === "MyPara")?.basedOn, "Normal");
  assert.equal(styles.find((s) => s.id === "MyPara")?.gallery, true);
  assert.equal(resolveStyle(styles, "Accent").run.italic, true);
  assert.equal(styles.find((s) => s.id === "Accent")?.type, "character");
  assert.equal(resolveStyle(styles, "Normal").run.font, "Cambria");
  assert.equal(resolveStyle(styles, "Normal").para.lineHeight, "1.15");
  assert.equal(resolveStyle(styles, "Heading1").run.size, 20);
  assert.equal(resolveStyle(styles, "Heading1").run.color, "#123456");
  assert.match(stylesCss(styles, ".word-doc"), /p\[data-style="MyPara"\] \{[^}]*font-family: "Georgia"/);

  // blocks in order
  const types = d.content!.map((n) => n.type);
  assert.deepEqual(types, [
    "tableOfContents", "paragraph", "heading", "paragraph", "heading", "orderedList", "paragraph", "bulletList", "orderedList", "table", "image", "pageBreak", "heading", "paragraph", "sectionBreak", "paragraph", "codeBlock", "horizontalRule", "paragraph",
  ]);
  assert.equal(d.content![0].attrs?.levels, 3);
  assert.equal(d.content![0].attrs?.title, "Contents");
  assert.equal(d.content![1].attrs?.styleId, "Title");
  assert.equal(d.content![2].attrs?.level, 1);
  assert.equal(d.content![12].attrs?.level, 3);
  assert.equal(d.content![13].attrs?.styleId, "MyPara");
  assert.equal(d.content![18].attrs?.styleId, "Quote");
  assert.equal(text(d.content![16]), "let x = 1;\nlet y = 2;");

  // paragraph formatting
  const para = d.content![3];
  assert.equal(para.attrs?.spaceBefore, 6);
  assert.equal(para.attrs?.spaceAfter, 12);
  assert.equal(para.attrs?.lineHeight, "1.5");
  assert.equal(para.attrs?.indLeft, 36);
  assert.equal(para.attrs?.indRight, 18);
  assert.equal(para.attrs?.indFirst, -18);
  assert.equal(para.attrs?.textAlign, "justify");

  // runs
  assert.ok(mark(findText(d, "Bold"), "bold"));
  const ts = mark(findText(d, "red Georgia"), "textStyle");
  assert.match(String(ts?.attrs?.fontFamily), /^"Georgia"/);
  assert.equal(ts?.attrs?.fontSize, "14pt");
  assert.equal(ts?.attrs?.color, "#ff0000");
  assert.equal(mark(findText(d, "highlighted"), "highlight")?.attrs?.color, "#ffff00");
  assert.equal(mark(findText(d, "custom shade"), "highlight")?.attrs?.color, "#ffd8b1");
  assert.ok(mark(findText(d, "2"), "subscript"));
  assert.equal(mark(findText(d, "link"), "link")?.attrs?.href, "https://example.com/a?b=1&c=2");
  assert.equal(mark(findText(d, "styled"), "textStyle")?.attrs?.charStyle, "Accent");

  // comments, with the reply and resolved state
  assert.equal(back.comments.length, 1);
  const c = back.comments[0];
  assert.equal(c.resolved, true);
  assert.deepEqual(c.messages.map((m) => [m.author, m.body]), [["Ada Lovelace", "Check this"], ["Bob", "Done"]]);
  assert.equal(c.messages[0].date, Date.UTC(2026, 0, 2));
  assert.equal(c.quote, "commented");
  assert.equal(mark(findText(d, "commented"), "comment")?.attrs?.threadId, IMPORTED_THREAD + c.key);

  // lists: nesting and formats
  const ol = d.content![5];
  assert.equal(ol.attrs?.numFmt, "decimal");
  assert.equal(ol.content!.length, 2);
  const nested = ol.content![0].content![1];
  assert.equal(nested.type, "orderedList");
  assert.equal(nested.attrs?.numFmt, "lowerLetter");
  assert.equal(nested.content!.length, 2);
  const deep = nested.content![0].content![1];
  assert.equal(deep.type, "bulletList");
  assert.equal(deep.attrs?.bullet, "square");
  assert.equal(text(deep), "deep");
  assert.equal(d.content![7].type, "bulletList");
  assert.equal(d.content![8].attrs?.start, 4);
  assert.equal(d.content![8].attrs?.numFmt, "upperRoman");

  // table: header row, merges, widths, shading, borders, vertical alignment
  const table = d.content![9];
  assert.equal(table.content!.length, 3);
  assert.deepEqual(table.content![0].content!.map((x) => x.type), ["tableHeader", "tableHeader", "tableHeader"]);
  const merged = table.content![1].content![0];
  assert.equal(merged.attrs?.colspan, 2);
  assert.deepEqual(merged.attrs?.colwidth, [120, 160]);
  assert.equal(merged.attrs?.background, "#d9e2f3");
  const tall = table.content![1].content![1];
  assert.equal(tall.attrs?.rowspan, 2);
  assert.equal(tall.attrs?.valign, "middle");
  const b = JSON.parse(String(tall.attrs?.borders));
  assert.equal(b.top, "2px solid #ff0000");
  assert.equal(b.right, "1px dashed #00ff00");
  assert.equal(b.bottom, "none");
  assert.equal(table.content![2].content!.length, 2);

  // image
  const img = d.content![10];
  assert.equal(img.attrs?.width, 64);
  assert.equal(img.attrs?.height, 32);
  assert.equal(img.attrs?.alt, "red dot");
  assert.equal(img.attrs?.align, "center");
  assert.match(String(img.attrs?.src), /^data:image\/png;base64,/);

  // sections
  const s1 = parseSection(d.content![14].attrs?.section);
  assert.equal(s1.pageWidth, 595.3);
  assert.equal(s1.margins.left, 54);
  assert.equal(s1.margins.header, 30);
  assert.equal(s1.titlePage, true);
  assert.equal(text(s1.headers!.first!), "First page header");
  assert.equal(text(s1.headers!.default!), "Report header ");
  assert.equal(s1.headers!.default!.content![0].attrs?.textAlign, "right");
  const fields = all(s1.footers!.default!, "pageField").map((f) => f.attrs?.kind);
  assert.deepEqual(fields, ["page", "pages"]);
  assert.equal(text(s1.footers!.default!), "Page  of ");
  const last = back.body;
  assert.equal(last.orientation, "landscape");
  assert.equal(last.pageWidth, 792);
  assert.deepEqual(last.columns, { count: 2, space: 24, separator: true });
  assert.equal(text(last.footers!.even!), "Even footer");
  assert.equal(last.headers, undefined);
  assert.equal(back.settings.evenAndOddHeaders, true);
});

test("the written package is well formed and keeps Word's element order", async () => {
  const { doc, body } = richDoc();
  const bytes = await buildDocx({ doc, body, styles: STYLES, comments: [{ id: "th1", messages: [{ author: "A", body: "x" }] }], headingPages: [1, 1, 2] });
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  for (const n of ["word/document.xml", "word/styles.xml", "word/numbering.xml", "word/settings.xml", "word/comments.xml", "word/commentsExtended.xml", "word/header1.xml", "word/footer1.xml", "[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels"]) assert.ok(names.includes(n), n);
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  for (const n of names.filter((x) => /^word\/(header|footer|comments)\d*\.xml$/.test(x))) assert.ok(ct.includes(`/${n}`), `content type for ${n}`);
  const xml = await zip.file("word/document.xml")!.async("string");
  // well-formed: tags balance
  const { parseXml } = await import("../lib/slides/xml");
  assert.equal(parseXml(xml).local, "document");
  // TOC field with cached entries and bookmarks on headings
  assert.match(xml, /TOC \\o "1-3" \\h \\z \\u/);
  assert.match(xml, /<w:bookmarkStart w:id="\d+" w:name="_Toc00000000"\/>/);
  assert.match(xml, /PAGEREF _Toc00000002 \\h <\/w:instrText>.*?<w:t>2<\/w:t>/);
  // sectPr children in schema order
  const sect = xml.slice(xml.lastIndexOf("<w:sectPr>"));
  const RANK = ["headerReference", "footerReference", "type", "pgSz", "pgMar", "pgNumType", "cols", "titlePg", "docGrid"];
  const ranks = [...sect.matchAll(/<w:(\w+)/g)].map((m) => RANK.indexOf(m[1])).filter((r) => r >= 0);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(ranks.includes(RANK.indexOf("cols")));
  // rPr children in schema order for the formatted run
  const rpr = /<w:rPr>(<w:rFonts w:ascii="Georgia".*?)<\/w:rPr>/.exec(xml)![1];
  const ro = [...rpr.matchAll(/<w:(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(ro, ["rFonts", "color", "sz", "szCs"]);
});

test("Word-shaped details: numbering continues, style-based lists, theme fonts, fields", async () => {
  // a hand-written minimal package, the way Word writes it
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>',
  );
  zip.file("word/theme/theme1.xml", '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
  zip.file(
    "word/styles.xml",
    `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:sz w:val="40"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>`,
  );
  zip.file(
    "word/numbering.xml",
    `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\uf0b7"/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  );
  const np = (id: number, lvl: number, s: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${s}</w:t></w:r></w:p>`;
  zip.file(
    "word/document.xml",
    `<w:document ${W}><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>German heading</w:t></w:r></w:p>` +
      np(1, 0, "one") + np(1, 1, "one.one") + np(1, 0, "two") +
      `<w:p><w:r><w:t xml:space="preserve">Interlude </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://x.test/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field link</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins></w:p>` +
      np(1, 0, "three") +
      `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>styled bullet</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>before</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  const back = await importDocx(await zip.generateAsync({ type: "uint8array" }));
  const d = back.doc;
  assert.deepEqual(d.content!.map((n) => n.type), ["heading", "orderedList", "paragraph", "orderedList", "bulletList", "paragraph", "pageBreak", "paragraph"]);
  assert.equal(d.content![0].attrs?.level, 1);
  const styles = mergeStyles(back.styles);
  assert.equal(resolveStyle(styles, "Heading1").run.font, "Aptos Display");
  assert.equal(resolveStyle(styles, "Heading1").run.size, 20);
  assert.equal(resolveStyle(styles, "Normal").run.font, "Aptos");
  assert.equal(resolveStyle(styles, "Normal").run.size, 12);
  assert.equal(resolveStyle(styles, "Normal").para.lineHeight, "1.16");
  // legal numbering keeps its level text; numbering continues after the interlude
  assert.equal(d.content![1].content![0].content![1].attrs?.lvlText, "%1.%2.");
  assert.equal(d.content![3].attrs?.start, 3);
  assert.equal(d.content![4].attrs?.bullet, "disc");
  assert.equal(text(d.content![2]), "Interlude field link\ttabbedgone added");
  assert.equal(mark(findText(d, "gone"), "deletion")?.attrs?.author, "Unknown");
  assert.ok(mark(findText(d, " added"), "insertion"));
  assert.equal(mark(findText(d, "field link"), "link")?.attrs?.href, "https://x.test/");
  assert.equal(back.body.pageWidth, 595.3);
  assert.equal(back.body.margins.bottom, 56.7);
});
