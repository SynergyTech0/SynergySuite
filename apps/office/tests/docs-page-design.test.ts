// Page design: watermark, page colour, page borders, line numbers, vertical
// alignment, mirror margins, hyphenation, balanced columns and a header that
// pushes the text down; in the layout and through .docx and back.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { paginate, type BlockBox } from "../lib/docs/paginate";
import { defaultSection, ptToPx, type PMNode, type Section } from "../lib/docs/model";
import { lineNumberLabels, readWatermark, watermarkVml, pageBorderBox } from "../lib/docs/page-design";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import { parseXml } from "../lib/slides/xml";

const letter = defaultSection();
const blocks = (n: number, h = 100): BlockBox[] => Array.from({ length: n }, () => ({ h, kind: "block" as const }));

test("line numbers count by, restart per page or section", () => {
  const lines = [0, 0, 0, 1, 1].map((page) => ({ page, section: 0 }));
  assert.deepEqual(lineNumberLabels(lines, () => ({ countBy: 1, start: 1, restart: "newPage", distance: 0 })), [1, 2, 3, 1, 2]);
  assert.deepEqual(lineNumberLabels(lines, () => ({ countBy: 2, start: 1, restart: "continuous", distance: 0 })), [null, 2, null, 4, null]);
  assert.deepEqual(lineNumberLabels([{ page: 0, section: 0 }, { page: 0, section: 1 }, { page: 1, section: 1 }], (s) => (s === 1 ? { countBy: 1, start: 10, restart: "newSection", distance: 0 } : undefined)), [null, 10, 11]);
});

test("mirror margins swap the inside margin on even pages", () => {
  const s: Section = { ...letter, margins: { ...letter.margins, left: 90, right: 54, gutter: 18 } };
  const l = paginate(blocks(12), new Array(12).fill(0), [s], { mirrorMargins: true });
  assert.equal(l.pages.length, 2);
  assert.equal(l.pages[0].marginLeft, ptToPx(108));
  assert.equal(l.pages[1].marginLeft, ptToPx(54));
  assert.equal(l.pages[1].marginRight, ptToPx(108));
  const second = l.place.find((p) => p.page === 1)!;
  assert.equal(second.left, l.pages[1].left + ptToPx(54));
});

test("a tall header pushes the text down", () => {
  const l = paginate(blocks(3), [0, 0, 0], [letter], {}, { hfHeight: (_s, kind) => (kind === "headers" ? 120 : 0) });
  assert.equal(l.pages[0].marginTop, ptToPx(36) + 124);
  assert.equal(l.place[0].y, ptToPx(36) + 124);
  const plain = paginate(blocks(3), [0, 0, 0], [letter], {}, { hfHeight: () => 15 });
  assert.equal(plain.pages[0].marginTop, ptToPx(72));
});

test("vertical alignment centres a page's text", () => {
  const s: Section = { ...letter, vAlign: "center" };
  const l = paginate(blocks(2), [0, 0], [s]);
  const free = ptToPx(792 - 144) - 200;
  assert.equal(Math.round(l.place[0].y), Math.round(ptToPx(72) + free / 2));
  assert.equal(Math.round(l.place[1].y), Math.round(ptToPx(72) + free / 2 + 100));
});

test("columns before a continuous break are balanced", () => {
  const two: Section = { ...letter, columns: { count: 2, space: 36 } };
  const after: Section = { ...letter, type: "continuous" };
  const bs: BlockBox[] = [...blocks(6, 50), { h: 0, kind: "sectionBreak" }, ...blocks(1, 50)];
  const sec = [0, 0, 0, 0, 0, 0, 0, 1];
  const l = paginate(bs, sec, [two, after]);
  const lefts = l.place.slice(0, 6).map((p) => p.left);
  const firstCol = lefts.filter((x) => x === lefts[0]).length;
  assert.equal(firstCol, 3);
  // the next section starts below the balanced columns (3 × 50px), not below a full column
  assert.equal(Math.round(l.place[7].y), Math.round(ptToPx(72) + 150));
});

test("page border box", () => {
  const b = pageBorderBox({ top: { style: "single", size: 1, color: "#ff0000", space: 24 }, offsetFrom: "page" }, { top: 96, right: 96, bottom: 96, left: 96 });
  assert.equal(b.top, 32);
  assert.equal(b.css.borderTop, "1pt solid #ff0000");
  const t = pageBorderBox({ left: { style: "double", size: 0.5, color: "#000000", space: 4 } }, { top: 96, right: 96, bottom: 96, left: 96 });
  assert.ok(Math.abs(t.left - (96 - 16 / 3)) < 0.01);
});

test("text watermark VML round-trips", () => {
  const xml = `<w:hdr xmlns:w="w" xmlns:v="v" xmlns:o="o" xmlns:w10="x"><w:p>${watermarkVml({ kind: "text", text: "DRAFT", font: "Arial", color: "#ff0000", size: 72, layout: "horizontal", semitransparent: false }, 468)}</w:p></w:hdr>`;
  const w = readWatermark(parseXml(xml) as never);
  assert.deepEqual(w, { kind: "text", text: "DRAFT", font: "Arial", color: "#ff0000", size: 72, layout: "horizontal", semitransparent: false });
});

test("page design round-trips through .docx", async () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const body: Section = {
    ...letter,
    vAlign: "center",
    pageBorders: { top: { style: "double", size: 0.75, color: "#1f4e79", space: 24 }, bottom: { style: "double", size: 0.75, color: "#1f4e79", space: 24 }, offsetFrom: "page", display: "notFirstPage" },
    lineNumbers: { countBy: 5, start: 1, restart: "newSection", distance: 18 },
  };
  const doc: PMNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] };
  const bytes = await buildDocx({ doc, body, settings: { watermark: { kind: "text", text: "CONFIDENTIAL", layout: "diagonal", color: "#c0c0c0" }, pageColor: "#fff2cc", mirrorMargins: true, autoHyphenation: true } });
  const zip = await JSZip.loadAsync(bytes);
  const main = await zip.file("word/document.xml")!.async("string");
  assert.match(main, /<w:background w:color="FFF2CC"\/><w:body>/);
  assert.match(main, /<w:pgBorders w:offsetFrom="page" w:display="notFirstPage"><w:top w:val="double" w:sz="6" w:space="24" w:color="1F4E79"\/>/);
  assert.match(main, /<w:lnNumType w:countBy="5" w:distance="360" w:restart="newSection"\/>/);
  assert.match(main, /<w:vAlign w:val="center"\/>/);
  assert.match(main, /<w:headerReference w:type="default"/);
  const hdr = await zip.file("word/header1.xml")!.async("string");
  assert.match(hdr, /PowerPlusWaterMarkObject/);
  assert.match(hdr, /string="CONFIDENTIAL"/);
  const settings = await zip.file("word/settings.xml")!.async("string");
  assert.match(settings, /<w:displayBackgroundShape\/><w:mirrorMargins\/>.*<w:defaultTabStop w:val="720"\/><w:autoHyphenation\/>/);
  const back = await importDocx(bytes);
  assert.equal(back.settings.pageColor, "#fff2cc");
  assert.equal(back.settings.mirrorMargins, true);
  assert.equal(back.settings.autoHyphenation, true);
  assert.equal(back.settings.watermark?.text, "CONFIDENTIAL");
  assert.equal(back.settings.watermark?.layout, "diagonal");
  assert.equal(back.body.vAlign, "center");
  assert.deepEqual(back.body.lineNumbers, body.lineNumbers);
  assert.equal(back.body.pageBorders?.display, "notFirstPage");
  assert.equal(back.body.pageBorders?.top?.style, "double");
  // the header that only holds the watermark stays empty in the editor
  assert.ok(!JSON.stringify(back.body.headers?.default || {}).includes('"text"'));
  // a picture watermark
  const pic = await buildDocx({ doc, settings: { watermark: { kind: "picture", image: PNG, washout: true } } });
  const pz = await JSZip.loadAsync(pic);
  assert.match(await pz.file("word/header1.xml")!.async("string"), /WordPictureWatermark1.*<v:imagedata r:id="rId1"/);
  assert.ok(pz.file(/word\/media\/watermark1\.png/).length);
  const pb = await importDocx(pic);
  assert.equal(pb.settings.watermark?.kind, "picture");
  assert.match(pb.settings.watermark?.image || "", /^data:image\/png;base64,/);
});
