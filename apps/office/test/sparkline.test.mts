// Sparklines: pairing data with cells, the drawing geometry, and the .xlsx
// round trip (x14 sparkline groups), checked against LibreOffice as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";
import { patchSparklines, readSparklines, sparkShape, sparklineExtXml, sparklinesFor, sourceValues, SPARK_DEFAULTS, SPARKLINE_RESOURCE, type SparklineGroup } from "../lib/sparkline.ts";

const g = (type: SparklineGroup["type"], extra: Partial<SparklineGroup> = {}): SparklineGroup => ({ id: "g", sheetId: "sheet-1", type, ...SPARK_DEFAULTS, items: [], ...extra });

test("one sparkline per data row (or column), placed in the location cells", () => {
  const data = { sheetId: "s", startRow: 1, endRow: 3, startColumn: 0, endColumn: 4 };
  const down = sparklinesFor(data, { startRow: 1, endRow: 3, startColumn: 5, endColumn: 5 });
  assert.deepEqual(down.map((s) => [s.row, s.column, s.source.startRow, s.source.endRow, s.source.startColumn, s.source.endColumn]), [
    [1, 5, 1, 1, 0, 4],
    [2, 5, 2, 2, 0, 4],
    [3, 5, 3, 3, 0, 4],
  ]);
  const across = sparklinesFor(data, { startRow: 4, endRow: 4, startColumn: 0, endColumn: 4 });
  assert.equal(across.length, 5);
  assert.deepEqual(across[2].source, { ...data, startColumn: 2, endColumn: 2 });
  assert.equal(sparklinesFor(data, { startRow: 0, endRow: 0, startColumn: 9, endColumn: 9 })[0].source, data);
  assert.throws(() => sparklinesFor(data, { startRow: 0, endRow: 1, startColumn: 9, endColumn: 9 }), /one cell for each row/);
});

test("source values keep gaps for empty and text cells", () => {
  const grid: unknown[][] = [[1, "", "x", "4.5", null, -2]];
  assert.deepEqual(sourceValues((r, c) => grid[r][c], { sheetId: "s", startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 }), [1, null, null, 4.5, null, -2]);
});

test("line geometry spans the box and marks high and low points", () => {
  const shape = sparkShape([1, 3, null, 2], g("line", { high: true, low: true }), 100, 20, 0);
  assert.equal(shape?.kind, "line");
  if (shape?.kind !== "line") return;
  assert.deepEqual(shape.points, [
    [0, 20],
    [100 / 3, 0],
    [100, 10],
  ]);
  assert.deepEqual(shape.markers.map((m) => [m.x, m.y]), [
    [0, 20],
    [100 / 3, 0],
  ]);
  assert.equal(sparkShape([null, null], g("line"), 100, 20), null);
});

test("columns grow from zero and win/loss bars sit on either side of the middle", () => {
  const cols = sparkShape([2, -2], g("column", { negative: true }), 20, 20, 0);
  assert.equal(cols?.kind, "bars");
  if (cols?.kind !== "bars") return;
  assert.equal(cols.axisY, 10);
  assert.deepEqual(cols.bars.map((b) => [b.y, b.h, b.color]), [
    [0, 10, SPARK_DEFAULTS.color],
    [10, 10, SPARK_DEFAULTS.negativeColor],
  ]);
  const wl = sparkShape([5, 0, -1], g("winloss"), 30, 20, 0);
  if (wl?.kind !== "bars") return assert.fail("bars expected");
  assert.equal(wl.bars.length, 2, "a zero draws nothing");
  assert.deepEqual(wl.bars.map((b) => [b.y, b.h]), [
    [0, 10],
    [10, 10],
  ]);
});

test("x14 sparkline XML goes in the worksheet extension list and reads back", () => {
  const groups: SparklineGroup[] = [
    g("line", { id: "a", markers: true, lineWeight: 1.5, items: [{ row: 0, column: 5, source: { sheetId: "sheet-1", startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 } }] }),
    g("winloss", { id: "b", color: "#00AA00", items: [{ row: 1, column: 5, source: { sheetId: "sheet-2", startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 } }] }),
  ];
  const names: Record<string, string> = { "sheet-1": "Data", "sheet-2": "Other sheet" };
  const ext = sparklineExtXml(groups, (id) => names[id]);
  assert.match(ext, /<x14:sparklineGroup displayEmptyCellsAs="gap" lineWeight="1.5" markers="1">/);
  assert.match(ext, /<x14:sparklineGroup type="stacked" displayEmptyCellsAs="gap"><x14:colorSeries rgb="FF00AA00"\/>/);
  assert.match(ext, /<xm:f>'Other sheet'!\$A\$1:\$E\$1<\/xm:f><xm:sqref>F2<\/xm:sqref>/);
  const sheet = `<worksheet><sheetData/><extLst><ext uri="{other}"><x/></ext></extLst></worksheet>`;
  const patched = patchSparklines(sheet, ext);
  assert.match(patched, /<extLst><ext uri="\{other\}"><x\/><\/ext><ext uri="\{05C60535/);
  assert.equal(patchSparklines(patched, ext).match(/05C60535/g)?.length, 1, "patching twice replaces");
  assert.equal(patchSparklines("<worksheet></worksheet>", ext).indexOf("<extLst><ext"), 11);
  const back = readSparklines(patched, "sheet-1", (n) => Object.entries(names).find(([, v]) => v === n)?.[0]);
  assert.deepEqual(
    back.map((x) => [x.type, x.color, x.markers ?? false, x.lineWeight, x.items]),
    groups.map((x) => [x.type, x.color, x.markers ?? false, x.lineWeight, x.items]),
  );
});

const book = (): UniverWorkbook => ({
  id: "u",
  name: "S",
  appVersion: "",
  locale: "enUS",
  styles: {},
  sheetOrder: ["sheet-1"],
  sheets: {
    "sheet-1": {
      id: "sheet-1",
      name: "Sales",
      cellData: {
        0: { 0: { v: 1 }, 1: { v: 4 }, 2: { v: 2 }, 3: { v: 5 } },
        1: { 0: { v: 3 }, 1: { v: -1 }, 2: { v: 0 }, 3: { v: 2 } },
        2: { 0: { v: -1 }, 1: { v: 1 }, 2: { v: -1 }, 3: { v: 1 } },
      },
    },
  },
  resources: [
    {
      name: SPARKLINE_RESOURCE,
      data: JSON.stringify({
        groups: [
          g("line", { id: "l", high: true, items: [{ row: 0, column: 4, source: { sheetId: "sheet-1", startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 } }] }),
          g("column", { id: "c", negative: true, items: [{ row: 1, column: 4, source: { sheetId: "sheet-1", startRow: 1, endRow: 1, startColumn: 0, endColumn: 3 } }] }),
          g("winloss", { id: "w", items: [{ row: 2, column: 4, source: { sheetId: "sheet-1", startRow: 2, endRow: 2, startColumn: 0, endColumn: 3 } }] }),
        ],
      }),
    },
  ],
});

const groupsOf = (b: UniverWorkbook) => JSON.parse(b.resources?.find((r) => r.name === SPARKLINE_RESOURCE)?.data || '{"groups":[]}').groups as SparklineGroup[];

test("sparklines round-trip through .xlsx", async () => {
  const bytes = await univerToXlsx(book());
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml, /<extLst><ext uri="\{05C60535-1F16-4fd2-B633-F4F36F0B64E0\}"/);
  assert.ok(xml.indexOf("<extLst>") > xml.indexOf("</sheetData>"));
  const back = groupsOf(await xlsxToUniver(bytes));
  assert.deepEqual(
    back.map((x) => [x.type, x.high ?? false, x.negative ?? false, x.items]),
    groupsOf(book()).map((x) => [x.type, x.high ?? false, x.negative ?? false, x.items]),
  );
});

test("LibreOffice keeps the sparklines", { skip: !existsSync("/usr/bin/soffice") && "LibreOffice not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "spark-"));
  try {
    const file = path.join(dir, "s.xlsx");
    writeFileSync(file, await univerToXlsx(book()));
    const out = path.join(dir, "out");
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/lo`, "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, file], { stdio: "ignore", timeout: 120_000 });
    const back = groupsOf(await xlsxToUniver(readFileSync(path.join(out, "s.xlsx"))));
    assert.deepEqual(back.map((x) => x.type).sort(), ["column", "line", "winloss"]);
    assert.deepEqual(back.flatMap((x) => x.items.map((i) => [i.row, i.column, i.source.startColumn, i.source.endColumn])).sort(), [
      [0, 4, 0, 3],
      [1, 4, 0, 3],
      [2, 4, 0, 3],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
