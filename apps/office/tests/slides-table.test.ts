// Tables: merged cells, borders, rows/columns, rich cell text and the .pptx round trip.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { Slide, TableCell, TableEl } from "../lib/slides/model";
import { anchorAt, dragColBorder, dragRowBorder, deleteCol, deleteRow, expandRect, htmlPlain, insertCol, insertRow, mergeCells, normalizeTable, setBorders, splitCell, withHtml } from "../lib/slides/table";

before(async () => {
  const spec = "jsdom";
  const { JSDOM } = await import(spec);
  const dom = new JSDOM("<!doctype html><body></body>");
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
});

const grid = (r: number, c: number): TableCell[][] => Array.from({ length: r }, (_, y) => Array.from({ length: c }, (_, x) => ({ text: `${y}${x}` })));
const table = (rows: TableCell[][], extra: Partial<TableEl> = {}): TableEl => ({ id: "t1", z: 1, type: "table", x: 100, y: 100, w: 600, h: 300, rows, ...extra });

test("merging keeps the content in the anchor and covers the rest; splitting frees it", () => {
  const m = mergeCells(grid(3, 3), { r0: 0, c0: 0, r1: 1, c1: 1 });
  assert.equal(m[0][0].cs, 2);
  assert.equal(m[0][0].rs, 2);
  assert.ok(m[0][1].merged && m[1][0].merged && m[1][1].merged);
  assert.equal(m[0][0].text, "00\n01\n10\n11");
  assert.deepEqual(anchorAt(m, 1, 1), [0, 0]);
  // a selection touching part of a merge grows to cover it
  assert.deepEqual(expandRect(m, { r0: 1, c0: 1, r1: 1, c1: 2 }), { r0: 0, c0: 0, r1: 1, c1: 2 });
  const s = splitCell(m, 1, 1);
  assert.ok(!s.flat().some((c) => c.merged || c.cs || c.rs));
  assert.equal(s[0][0].text, "00\n01\n10\n11");
});

test("rows and columns inserted through a merge grow it; deleting shrinks or moves it", () => {
  const m = mergeCells(grid(3, 3), { r0: 0, c0: 1, r1: 2, c1: 1 }); // column 1 merged down
  const r = insertRow(table(m), 1);
  assert.equal(r.rows.length, 4);
  assert.equal(r.rows[0][1].rs, 4);
  assert.equal(r.h, 400);
  const d = deleteRow(table(m), 0)!;
  assert.equal(d.rows[0][1].rs, 2);
  assert.ok(!d.rows[0][1].merged);
  const h = mergeCells(grid(2, 3), { r0: 0, c0: 0, r1: 0, c1: 2 });
  const c = insertCol(table(h, { colW: [100, 200, 300] }), 1);
  assert.equal(c.rows[0][0].cs, 4);
  assert.deepEqual(c.colW, [100, 100, 200, 300]);
  const dc = deleteCol(table(h, { colW: [100, 200, 300] }), 0)!;
  assert.equal(dc.rows[0][0].cs, 2);
  assert.deepEqual(dc.colW, [200, 300]);
  assert.equal(deleteRow(table(grid(1, 2)), 0), null);
});

test("borders are written on both cells sharing an edge", () => {
  const b = setBorders(grid(2, 2), { r0: 0, c0: 0, r1: 0, c1: 0 }, "outer", { c: "FF0000", w: 3 });
  assert.deepEqual(b[0][0].bd, { t: { c: "FF0000", w: 3 }, b: { c: "FF0000", w: 3 }, l: { c: "FF0000", w: 3 }, r: { c: "FF0000", w: 3 } });
  assert.deepEqual(b[1][0].bd, { t: { c: "FF0000", w: 3 } });
  assert.deepEqual(b[0][1].bd, { l: { c: "FF0000", w: 3 } });
  const none = setBorders(b, { r0: 0, c0: 0, r1: 1, c1: 1 }, "none", { c: "000000", w: 1 });
  assert.ok(none.flat().every((c) => Object.values(c.bd || {}).every((x) => x.w === 0)));
});

test("rich cell text keeps a plain copy for search", () => {
  const c = withHtml({ text: "" }, "<p><strong>Big</strong> deal</p><p>two &amp; three</p>");
  assert.equal(c.text, "Big deal\ntwo & three");
  assert.equal(htmlPlain("<p>a<br>b</p>"), "a\nb");
  // plain paragraphs need no HTML copy
  assert.equal(withHtml({ text: "x" }, "<p>one</p>").html, undefined);
  assert.equal(normalizeTable([[{ text: "a", cs: 5 }], [{ text: "b" }, { text: "c" }]])[0][0].cs, 2);
});

test("tables round-trip through .pptx: merges, borders, fills, rich text, sizes", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  let rows = mergeCells(grid(3, 3), { r0: 0, c0: 0, r1: 0, c1: 1 });
  rows = mergeCells(rows, { r0: 1, c0: 2, r1: 2, c1: 2 });
  rows = setBorders(rows, { r0: 2, c0: 0, r1: 2, c1: 1 }, "bottom", { c: "C00000", w: 3 });
  rows[1][0] = { ...withHtml(rows[1][0], "<p><strong>Bold</strong> and <em>italic</em></p><p><span style=\"color: #00b050\">green</span></p>"), fill: "FFF2CC", valign: "top" };
  rows[2][0] = { ...rows[2][0], bold: true, color: "1F4E79", align: "center" };
  const el = table(rows, { colW: [300, 150, 150], rowH: [60, 140, 100], fontSize: 16 });
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [el] };
  const out = await buildPptx([s], { name: "t", w: 1280, h: 720, theme: "plain" });
  const xml = await (await JSZip.loadAsync(out)).file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /gridSpan="2"/);
  assert.match(xml, /rowSpan="2"/);
  assert.match(xml, /hMerge="1"/);
  assert.match(xml, /vMerge="1"/);
  const deck = await importPptx(out);
  const t = deck.slides[0].elements[0] as TableEl;
  assert.equal(t.type, "table");
  assert.equal(t.fontSize, 16);
  assert.equal(t.rows[0][0].cs, 2);
  assert.ok(t.rows[0][1].merged);
  assert.equal(t.rows[1][2].rs, 2);
  assert.ok(t.rows[2][2].merged);
  assert.equal(t.rows[1][0].fill, "FFF2CC");
  assert.equal(t.rows[1][0].valign, "top");
  assert.match(t.rows[1][0].html || "", /<strong>Bold<\/strong>/);
  assert.match(t.rows[1][0].html || "", /<em>italic<\/em>/);
  assert.match(t.rows[1][0].html || "", /color: #00b050/);
  assert.equal(t.rows[1][0].text, "Bold and italic\ngreen");
  assert.equal(t.rows[2][0].bold, true);
  assert.equal(t.rows[2][0].color, "1F4E79");
  assert.equal(t.rows[2][0].align, "center");
  assert.equal(t.rows[2][0].html, undefined);
  assert.deepEqual(t.rows[2][0].bd?.b, { c: "C00000", w: 3 });
  assert.deepEqual(t.rows[2][1].bd?.b, { c: "C00000", w: 3 });
  assert.equal(t.rows[0][0].bd, undefined); // default lines stay implicit
  assert.deepEqual(t.colW, [300, 150, 150]);
  assert.deepEqual(t.rowH, [60, 140, 100]);
});

test("dragging borders: inner column borders trade width, edges and rows resize the table", () => {
  assert.deepEqual(dragColBorder([100, 100, 100], 0, 30), { colW: [130, 70, 100], w: 300 });
  // never below the smallest size
  assert.deepEqual(dragColBorder([100, 100, 100], 1, 500), { colW: [100, 188, 12], w: 300 });
  assert.deepEqual(dragColBorder([100, 100, 100], 2, -40), { colW: [100, 100, 60], w: 260 });
  assert.deepEqual(dragRowBorder([40, 40], 0, 25.04), { rowH: [65, 40], h: 105 });
  assert.deepEqual(dragRowBorder([40, 40], 1, -100), { rowH: [40, 12], h: 52 });
});

test("table styles: parts layer as PowerPoint layers them; a cell's own formatting wins", async () => {
  const { styledRows, partsAt, DEFAULT_TABLE_STYLE } = await import("../lib/slides/table-style");
  const ts = { id: DEFAULT_TABLE_STYLE, first: true, bandRow: true };
  assert.deepEqual(partsAt(ts, 0, 0, 4, 3), ["whole", "firstRow"]);
  assert.deepEqual(partsAt(ts, 1, 0, 4, 3), ["whole", "band1H"]);
  assert.deepEqual(partsAt(ts, 2, 0, 4, 3), ["whole", "band2H"]);
  const rows = grid(4, 3);
  rows[2][1] = { ...rows[2][1], fill: "FFC000" };
  const out = styledRows(table(rows, { tstyle: ts }), "4472C4", "000000");
  assert.equal(out[0][0].fill, "4472C4"); // header: accent, white bold text
  assert.equal(out[0][0].color, "FFFFFF");
  assert.equal(out[0][0].bold, true);
  assert.equal(out[1][0].fill, "B4C7E7"); // band 1: accent at 40%
  assert.equal(out[2][0].fill, "DAE3F3"); // band 2: the whole table's fill (20%)
  assert.equal(out[2][1].fill, "FFC000"); // own fill wins
  assert.deepEqual(out[1][1].bd?.t, { c: "FFFFFF", w: 1 });
  assert.equal(styledRows(table(grid(2, 2)), "4472C4", "000000")[0][0].fill, undefined); // no style: as is
});

test("table styles round-trip through .pptx: style id, part flags, definitions; cell colours left to the style", async () => {
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { schemaProblems } = await import("./fixtures/ooxml-check.mts");
  const rows = grid(3, 3);
  rows[1][1] = { ...rows[1][1], fill: "FFC000", color: "C00000" };
  const el = table(rows, { tstyle: { id: "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}", first: true, bandRow: true, lastCol: true } });
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [el] };
  const out = await buildPptx([s], { name: "t", w: 1280, h: 720, theme: "plain" });
  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(xml, /<a:tblPr firstRow="1" lastCol="1" bandRow="1"><a:tableStyleId>\{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5\}<\/a:tableStyleId><\/a:tblPr>/);
  assert.doesNotMatch(xml, /010203/);
  // style-decided cells carry no fill, text colour or lines of their own
  const cells = [...xml.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((m) => m[0]);
  assert.doesNotMatch(cells[0], /<a:ln[LRTB]|<a:srgbClr/);
  assert.match(cells[4], /<a:srgbClr val="FFC000"\/>/);
  assert.match(cells[4], /<a:srgbClr val="C00000"\/>/);
  const styles = await zip.file("ppt/tableStyles.xml")!.async("string");
  assert.match(styles, /<a:tblStyle styleId="\{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5\}" styleName="Light Style 1 - Accent 1"><a:wholeTbl>/);
  assert.deepEqual(schemaProblems(styles), []);
  const t = (await importPptx(out)).slides[0].elements[0] as TableEl;
  assert.deepEqual(t.tstyle, { id: "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}", first: true, lastCol: true, bandRow: true });
  assert.equal(t.rows[0][0].fill, undefined);
  assert.equal(t.rows[0][0].bold, undefined);
  assert.equal(t.rows[1][1].fill, "FFC000");
  assert.equal(t.rows[1][1].color, "C00000");
});

test("a foreign deck's own table style is read from tableStyles.xml with its look", async () => {
  const { importPptx } = await import("../lib/slides/pptx-import");
  const { buildPptx } = await import("../lib/slides/pptx-export");
  const el = table(grid(2, 2), { tstyle: { id: "{11111111-2222-3333-4444-555555555555}", name: "Brand", first: true, look: { whole: { fill: "EEEEEE", line: "999999" }, firstRow: { fill: "102030", color: "FFFFFF", bold: true } } } });
  const s: Slide = { id: "s1", title: "", body: "", notes: "", layout: "blank", bg: "", bgImg: "", elements: [el] };
  const out = await buildPptx([s], { name: "t", w: 1280, h: 720, theme: "plain" });
  const t = (await importPptx(out)).slides[0].elements[0] as TableEl;
  assert.equal(t.tstyle?.name, "Brand");
  assert.deepEqual(t.tstyle?.look?.firstRow, { fill: "102030", color: "FFFFFF", bold: true });
  assert.deepEqual(t.tstyle?.look?.whole, { fill: "EEEEEE", line: "999999" });
});
