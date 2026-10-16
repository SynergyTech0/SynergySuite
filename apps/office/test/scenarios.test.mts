// Scenario Manager: cell lists, the summary table, moving with inserted rows,
// and the .xlsx round trip (the worksheet's <scenarios>), checked with openpyxl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";
import { parseCellList, patchScenarios, readScenarios, scenarioSummary, scenariosXml, SCENARIO_RESOURCE, typedValue, type Scenario } from "../lib/scenarios.ts";
import { foldScenarios } from "../lib/sheet-what-if.ts";

const best: Scenario = { id: "a", sheetId: "sheet-1", name: "Best case", cells: [{ row: 0, column: 1, value: 120 }, { row: 1, column: 1, value: 0.2 }], comment: "Created by Ann & co" };
const worst: Scenario = { id: "b", sheetId: "sheet-1", name: "Worst", cells: [{ row: 0, column: 1, value: 80 }] };

test("cell lists and typed values", () => {
  assert.deepEqual(parseCellList("B1, $B$2:B3"), [{ row: 0, column: 1 }, { row: 1, column: 1 }, { row: 2, column: 1 }]);
  assert.equal(parseCellList("B1:B40"), null, "more than 32 cells");
  assert.equal(parseCellList("nope"), null);
  assert.deepEqual(["12", "1e3", "true", "abc", "", "007x"].map(typedValue), [12, 1000, true, "abc", null, "007x"]);
});

test("the summary lists changing and result cells per scenario", () => {
  const rows = scenarioSummary([best, worst], [{ row: 0, column: 1 }, { row: 1, column: 1 }], { changing: [100, 0.1], results: [10] }, [{ cell: { row: 4, column: 2 }, perScenario: [24, 8] }]);
  assert.deepEqual(rows.slice(0, 6), [
    ["Scenario Summary", null, "Current Values:", "Best case", "Worst"],
    ["Changing Cells:", null, null, null, null],
    [null, "B1", 100, 120, 80],
    [null, "B2", 0.1, 0.2, 0.1],
    ["Result Cells:", null, null, null, null],
    [null, "C5", 10, 24, 8],
  ]);
});

test("inserted rows move the changing cells", () => {
  const moved = foldScenarios([best], { id: "sheet.mutation.insert-row", params: { unitId: "u", subUnitId: "sheet-1", range: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 10 } } });
  assert.deepEqual(moved[0].cells.map((c) => c.row), [0, 3]);
  assert.equal(foldScenarios([best], { id: "sheet.mutation.insert-row", params: { unitId: "u", subUnitId: "other", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } } })[0], best);
});

test("scenarios XML sits before the filter and reads back", () => {
  const xml = scenariosXml([best, worst]);
  assert.match(xml, /^<scenarios current="0" show="0" sqref="B1 B2"><scenario name="Best case" locked="1" count="2" comment="Created by Ann &amp; co"><inputCells r="B1" val="120"\/>/);
  const sheet = patchScenarios("<worksheet><sheetData/><sheetProtection sheet=\"1\"/><autoFilter ref=\"A1:B2\"/></worksheet>", xml);
  assert.ok(sheet.indexOf("<scenarios") > sheet.indexOf("<sheetProtection") && sheet.indexOf("<scenarios") < sheet.indexOf("<autoFilter"));
  const back = readScenarios(sheet, "sheet-1");
  assert.deepEqual(back.map((s) => [s.name, s.cells, s.comment]), [
    [best.name, best.cells, best.comment],
    [worst.name, worst.cells, undefined],
  ]);
});

const book = (): UniverWorkbook => ({
  id: "u",
  name: "What if",
  appVersion: "",
  locale: "enUS",
  styles: {},
  sheetOrder: ["sheet-1"],
  sheets: { "sheet-1": { id: "sheet-1", name: "Model", cellData: { 0: { 0: { v: "Units" }, 1: { v: 100 } }, 1: { 0: { v: "Margin" }, 1: { v: 0.1 } }, 4: { 2: { f: "=B1*B2", v: 10 } } } } },
  resources: [{ name: SCENARIO_RESOURCE, data: JSON.stringify({ scenarios: [best, worst] }) }],
});

test("scenarios round-trip through .xlsx and openpyxl reads them", async () => {
  const bytes = await univerToXlsx(book());
  const xml = await (await JSZip.loadAsync(bytes)).file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml, /<scenarios /);
  const back = JSON.parse((await xlsxToUniver(bytes)).resources!.find((r) => r.name === SCENARIO_RESOURCE)!.data).scenarios as Scenario[];
  assert.deepEqual(back.map((s) => [s.name, s.cells]), [
    [best.name, best.cells],
    [worst.name, worst.cells],
  ]);
  const dir = mkdtempSync(path.join(tmpdir(), "scen-"));
  try {
    const file = path.join(dir, "s.xlsx");
    writeFileSync(file, bytes);
    const py = execFileSync("python3", ["-c", "import sys,openpyxl;ws=openpyxl.load_workbook(sys.argv[1])['Model'];print([(s.name,[(c.r,c.val) for c in s.inputCells]) for s in ws.scenarios.scenario])", file]).toString().trim();
    assert.equal(py, "[('Best case', [('B1', '120'), ('B2', '0.2')]), ('Worst', [('B1', '80')])]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
