// Shapes and text boxes: outline geometry and the .xlsx round trip (Excel
// shapes in the drawing part), checked against LibreOffice as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";
import { newShape, placeInWorksheet, readShapes, shapeAnchorXml, shapeParts, shapePath, SHAPE_COMPONENT, type ShapeData } from "../lib/sheet-shapes.ts";
import { PRESET_NAMES, presetParts } from "../lib/shape-presets.ts";

test("outline paths fit the box", () => {
  assert.equal(shapePath({ kind: "rect" }, 100, 50), "M0 0H100V50H0Z");
  assert.equal(shapePath({ kind: "triangle" }, 100, 50), "M50 0L100 50H0Z");
  assert.equal(shapePath({ kind: "line", flipV: true }, 100, 50), "M0 50L100 0");
  assert.equal(shapePath({ kind: "rightArrow" }, 100, 40), "M0 10H80V0L100 20L80 40V30H0Z");
  assert.match(shapePath({ kind: "ellipse" }, 100, 50), /^M0 25A50 25 0 1 0 100 25A50 25/);
});

test("a shape is written as an Excel shape and read back", () => {
  const s: ShapeData = { ...newShape("ellipse"), text: "Hello & <bye>\nline 2", bold: true, fill: "#FF0000", line: null, align: "l", vAlign: "b" };
  const xml = shapeAnchorXml(s, { from: { column: 1, columnOffset: 5, row: 2, rowOffset: 0 }, to: { column: 3, columnOffset: 0, row: 6, rowOffset: 10 } }, { width: 200, height: 90 }, 7);
  assert.match(xml, /<xdr:from><xdr:col>1<\/xdr:col><xdr:colOff>47625<\/xdr:colOff>/);
  assert.match(xml, /<a:prstGeom prst="ellipse">/);
  assert.match(xml, /<a:solidFill><a:srgbClr val="FF0000"\/><\/a:solidFill><a:ln w="12700"><a:noFill\/><\/a:ln>/);
  assert.match(xml, /<a:t>Hello &amp; &lt;bye&gt;<\/a:t>/);
  const [back] = readShapes(`<xdr:wsDr>${xml}</xdr:wsDr>`);
  assert.deepEqual(back.from, { column: 1, columnOffset: 5, row: 2, rowOffset: 0 });
  assert.deepEqual(back.to, { column: 3, columnOffset: 0, row: 6, rowOffset: 10 });
  assert.deepEqual({ ...back.data, name: undefined }, { ...s, name: undefined });
});

test("shapes styled by theme take the theme colours; pictures are not shapes", () => {
  const xml = `<xdr:wsDr xmlns:xdr="x" xmlns:a="a"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
  <xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Star 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="cloud"><a:avLst/></a:prstGeom></xdr:spPr>
  <xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/><a:lumMod val="75000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style>
  <xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400"/><a:t>Go</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
  <xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Picture"/></xdr:nvPicPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
  const shapes = readShapes(xml);
  assert.equal(shapes.length, 1);
  const d = shapes[0].data;
  assert.deepEqual([d.kind, d.prst, d.fill, d.line, d.color, d.fontSize, d.text, d.name], ["rect", "cloud", "#ED7D31", "#335693", "#FFFFFF", 14, "Go", "Star 1"]);
  assert.deepEqual(shapes[0].size, { width: 100, height: 50 });
  // Written back with its own preset.
  assert.match(shapeAnchorXml(d, { from: shapes[0].from, to: shapes[0].to! }, shapes[0].size, 2), /prst="cloud"/);
});

test("the drawing element goes before the extension list", () => {
  assert.equal(placeInWorksheet("<worksheet><sheetData/><extLst><ext/></extLst></worksheet>", "<drawing/>"), "<worksheet><sheetData/><drawing/><extLst><ext/></extLst></worksheet>");
  assert.equal(placeInWorksheet("<worksheet><sheetData/></worksheet>", "<drawing/>"), "<worksheet><sheetData/><drawing/></worksheet>");
});

const shapeDrawing = (id: string, data: ShapeData, t: { left: number; top: number; width: number; height: number }) => ({
  drawingId: id,
  drawingType: 8,
  componentKey: SHAPE_COMPONENT,
  unitId: "u",
  subUnitId: "sheet-1",
  transform: t,
  data,
});
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAQYGBgB6JgYBnxWv0AAAAABJRU5ErkJggg==";
const book = (): UniverWorkbook => ({
  id: "u",
  name: "Shapes",
  appVersion: "",
  locale: "enUS",
  styles: {},
  sheetOrder: ["sheet-1"],
  sheets: { "sheet-1": { id: "sheet-1", name: "Board", defaultColumnWidth: 100, defaultRowHeight: 20, cellData: { 0: { 0: { v: "x" } } } } },
  resources: [
    {
      name: "SHEET_DRAWING_PLUGIN",
      data: JSON.stringify({
        "sheet-1": {
          order: ["img", "s1", "s2"],
          data: {
            img: {
              drawingId: "img",
              drawingType: 0,
              imageSourceType: "BASE64",
              source: png,
              unitId: "u",
              subUnitId: "sheet-1",
              sheetTransform: { from: { column: 5, columnOffset: 0, row: 0, rowOffset: 0 }, to: { column: 6, columnOffset: 0, row: 2, rowOffset: 0 } },
              transform: { left: 500, top: 0, width: 100, height: 40 },
            },
            s1: shapeDrawing("s1", { ...newShape("roundRect"), text: "Total" }, { left: 150, top: 30, width: 200, height: 60 }),
            s2: shapeDrawing("s2", { ...newShape("textbox"), text: "Note to self" }, { left: 0, top: 100, width: 120, height: 40 }),
          },
        },
      }),
    },
  ],
});

const drawingsOf = (b: UniverWorkbook) => JSON.parse(b.resources!.find((r) => r.name === "SHEET_DRAWING_PLUGIN")!.data)["sheet-1"];

test("shapes round-trip through .xlsx next to pictures", async () => {
  const bytes = await univerToXlsx(book());
  const zip = await JSZip.loadAsync(bytes);
  const drawing = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  assert.equal((drawing.match(/<xdr:pic>/g) || []).length, 1);
  assert.equal((drawing.match(/<xdr:sp /g) || []).length, 2);
  assert.match(drawing, /<xdr:from><xdr:col>1<\/xdr:col><xdr:colOff>476250<\/xdr:colOff><xdr:row>1<\/xdr:row><xdr:rowOff>95250<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>3<\/xdr:col><xdr:colOff>476250<\/xdr:colOff><xdr:row>4<\/xdr:row><xdr:rowOff>95250<\/xdr:rowOff>/);
  assert.match(drawing, /<xdr:cNvSpPr txBox="1"\/>/);
  const back = drawingsOf(await xlsxToUniver(bytes));
  const items = back.order.map((id: string) => back.data[id]);
  assert.deepEqual(items.map((d: any) => d.drawingType), [0, 8, 8], "the picture stays a picture");
  const [, s1, s2] = items;
  assert.deepEqual(s1.transform, { left: 150, top: 30, width: 200, height: 60, flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 });
  assert.deepEqual([s1.componentKey, s1.data.kind, s1.data.text, s2.data.kind, s2.data.text], [SHAPE_COMPONENT, "roundRect", "Total", "textbox", "Note to self"]);
});

test("LibreOffice reads the shapes and writes them back", { skip: !existsSync("/usr/bin/soffice") && "LibreOffice not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shapes-"));
  try {
    const file = path.join(dir, "s.xlsx");
    writeFileSync(file, await univerToXlsx(book()));
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/lo`, "--convert-to", "ods", "--outdir", dir, file], { stdio: "ignore", timeout: 120_000 });
    const content = await (await JSZip.loadAsync(readFileSync(path.join(dir, "s.ods")))).file("content.xml")!.async("string");
    assert.equal((content.match(/<draw:custom-shape\b/g) || []).length, 2);
    assert.match(content, /Note to self/);
    const out = path.join(dir, "out");
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/lo`, "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, path.join(dir, "s.ods")], { stdio: "ignore", timeout: 120_000 });
    const back = drawingsOf(await xlsxToUniver(readFileSync(path.join(out, "s.xlsx"))));
    const shapes = back.order.map((id: string) => back.data[id]).filter((d: any) => d.drawingType === 8);
    assert.deepEqual(shapes.map((d: any) => d.data.text).sort(), ["Note to self", "Total"]);
    const total = shapes.find((d: any) => d.data.text === "Total");
    assert.equal(total.data.kind, "roundRect");
    assert.ok(Math.abs(total.transform.left - 150) <= 2 && Math.abs(total.transform.width - 200) <= 2, JSON.stringify(total.transform));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grouped shapes stay grouped (nested groups too), each shape where it sits in the group", () => {
  const sp = (id: number, prst: string, x: number, y: number, cx: number, cy: number, text = "") =>
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="S${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00B050"/></a:solidFill></xdr:spPr>${text ? `<xdr:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></xdr:txBody>` : ""}</xdr:sp>`;
  const E = 9525;
  // The group: 200x100 px at its anchor, its children in a space scaled by 2 (chExt is half of ext).
  const xml = `<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group 1"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr>
      <xdr:grpSpPr><a:xfrm><a:off x="${500 * E}" y="${700 * E}"/><a:ext cx="${200 * E}" cy="${100 * E}"/><a:chOff x="${1000 * E}" y="${1000 * E}"/><a:chExt cx="${100 * E}" cy="${50 * E}"/></a:xfrm></xdr:grpSpPr>
      ${sp(2, "diamond", 1000 * E, 1000 * E, 20 * E, 10 * E, "Start")}
      ${sp(3, "chevron", 1050 * E, 1025 * E, 25 * E, 10 * E)}
      <xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="4" name="Group 4"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr>
        <xdr:grpSpPr><a:xfrm><a:off x="${1080 * E}" y="${1000 * E}"/><a:ext cx="${20 * E}" cy="${20 * E}"/><a:chOff x="0" y="0"/><a:chExt cx="${20 * E}" cy="${20 * E}"/></a:xfrm></xdr:grpSpPr>
        ${sp(5, "star5", 10 * E, 0, 10 * E, 10 * E)}
      </xdr:grpSp>
    </xdr:grpSp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
  const shapes = readShapes(xml);
  assert.equal(shapes.length, 1, "the group stays one shape");
  const [g] = shapes;
  assert.deepEqual([g.data.kind, g.data.name, g.from.column, g.from.row, g.to?.column, g.to?.row, g.size.width, g.size.height], ["group", "Group 1", 2, 3, 6, 8, 200, 100]);
  const kids = g.data.children!;
  assert.deepEqual(kids.map((c) => [c.data.kind, c.data.name, c.x, c.y, c.w, c.h]), [
    ["diamond", "S2", 0, 0, 0.2, 0.2],
    ["chevron", "S3", 0.5, 0.5, 0.25, 0.2],
    ["group", "Group 4", 0.8, 0, 0.2, 0.4],
  ]);
  assert.deepEqual(kids[2].data.children!.map((c) => [c.data.kind, c.x, c.y, c.w, c.h]), [["star5", 0.5, 0, 0.5, 0.5]]);
  assert.equal(kids[0].data.text, "Start");
  assert.equal(kids[0].data.fill, "#00B050");
  // Written back as a group (with its nested group), and read back the same.
  const out = shapeAnchorXml(g.data, { from: g.from, to: g.to! }, g.size, 2);
  assert.equal((out.match(/<xdr:grpSp>/g) || []).length, 2);
  assert.deepEqual([...out.matchAll(/cNvPr id="(\d+)"/g)].map((m) => Number(m[1])), [2, 3, 4, 5, 6]);
  const again = readShapes(`<xdr:wsDr>${out}</xdr:wsDr>`)[0];
  assert.deepEqual(again.data.children!.map((c) => [c.data.kind, Math.round(c.x * 100), Math.round(c.y * 100), Math.round(c.w * 100), Math.round(c.h * 100)]), [
    ["diamond", 0, 0, 20, 20],
    ["chevron", 50, 50, 25, 20],
    ["group", 80, 0, 20, 40],
  ]);
});

test("all of Excel's preset shapes are drawn (and written back by name)", () => {
  assert.equal(shapePath({ kind: "diamond" }, 100, 50), "M50 0 L100 25 L50 50 L0 25 Z");
  assert.match(shapePath({ kind: "star5" }, 100, 100), /^M50 0/);
  const xml = shapeAnchorXml(newShape("chevron"), { from: { column: 0, columnOffset: 0, row: 0, rowOffset: 0 }, to: { column: 2, columnOffset: 0, row: 2, rowOffset: 0 } }, { width: 100, height: 40 }, 2);
  assert.match(xml, /<a:prstGeom prst="chevron">/);
  assert.equal(readShapes(`<xdr:wsDr>${xml}</xdr:wsDr>`)[0].data.kind, "chevron");
  const cloud = xml.replace('prst="chevron"', 'prst="cloud"');
  const [c] = readShapes(`<xdr:wsDr>${cloud}</xdr:wsDr>`);
  assert.equal(c.data.kind, "rect");
  assert.equal(c.data.prst, "cloud");
  // Drawn from the preset's geometry, not as a rectangle.
  const parts = shapeParts(c.data, 100, 60);
  assert.ok(parts[0].d.includes("A") || parts[0].d.includes("C"), parts[0].d.slice(0, 80));
  assert.equal(PRESET_NAMES.length, 187);
  for (const name of PRESET_NAMES) {
    const ps = presetParts(name, 120, 80)!;
    assert.ok(ps.length && ps.every((x) => x.d && !/NaN|Infinity/.test(x.d)), name);
  }
});
