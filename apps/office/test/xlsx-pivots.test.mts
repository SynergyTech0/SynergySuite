// Pivot tables written to .xlsx as real pivot tables (cache + table parts),
// checked with openpyxl and LibreOffice, and read back as definitions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { xlsxToUniver, univerToXlsx, type UniverWorkbook } from "../lib/xlsx.ts";
import { PIVOT_RESOURCE, type PivotDef } from "../lib/pivot.ts";

const rows: (string | number | null)[][] = [
  ["Region", "Year", "Amount", "Rep"],
  ["East", 2024, 100, "Ann"],
  ["West", 2024, 10, "Bo"],
  ["East", 2025, 25, "Ann"],
  ["East", 2024, 50, null],
  ["West", 2025, 7, "Cy"],
];
const def: PivotDef = {
  id: "pv1",
  name: "Pivot 1",
  source: { sheetId: "sheet-1", range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 3 } },
  target: { sheetId: "sheet-2", row: 2, column: 0 },
  rows: ["Region"],
  columns: ["Year"],
  values: [
    { field: "Amount", agg: "sum" },
    { field: "Amount", agg: "average" },
  ],
  filters: [{ field: "Rep", exclude: ["Cy"] }],
  lastSize: { rows: 5, columns: 4 },
};
const book = (): UniverWorkbook => {
  const cellData: Record<number, Record<number, { v: string | number }>> = {};
  rows.forEach((r, i) => r.forEach((v, j) => v != null && ((cellData[i] ||= {})[j] = { v })));
  return {
    id: "u",
    name: "P",
    appVersion: "",
    locale: "enUS",
    styles: {},
    sheetOrder: ["sheet-1", "sheet-2"],
    sheets: { "sheet-1": { id: "sheet-1", name: "Sales data", cellData }, "sheet-2": { id: "sheet-2", name: "Pivot 1", cellData: { 2: { 0: { v: "Sum of Amount" } } } } },
    resources: [{ name: PIVOT_RESOURCE, data: JSON.stringify({ pivots: [def] }) }],
  };
};

test("a pivot table becomes an Excel pivot cache and pivot table", async () => {
  const bytes = await univerToXlsx(book());
  const zip = await JSZip.loadAsync(bytes);
  const read = (p: string) => zip.file(p)!.async("string");
  const wbXml = await read("xl/workbook.xml");
  assert.match(wbXml, /<pivotCaches><pivotCache cacheId="1" r:id="rId\d+"\/><\/pivotCaches>/);
  assert.ok(wbXml.indexOf("<pivotCaches>") > wbXml.indexOf("</sheets>"));
  const cache = await read("xl/pivotCache/pivotCacheDefinition1.xml");
  assert.match(cache, /refreshOnLoad="1"/);
  assert.match(cache, /<worksheetSource ref="A1:D6" sheet="Sales data"\/>/);
  assert.match(cache, /<cacheField name="Region" numFmtId="0"><sharedItems count="2"><s v="East"\/><s v="West"\/><\/sharedItems>/);
  assert.match(cache, /<cacheField name="Amount" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="7" maxValue="100"\/>/);
  assert.match(cache, /<cacheField name="Rep" numFmtId="0"><sharedItems containsBlank="1" count="4">/);
  const records = await read("xl/pivotCache/pivotCacheRecords1.xml");
  assert.match(records, /count="5"><r><x v="0"\/><x v="0"\/><n v="100"\/><x v="0"\/><\/r>/);
  const table = await read("xl/pivotTables/pivotTable1.xml");
  assert.match(table, /<location ref="A3:D7" firstHeaderRow="1" firstDataRow="2" firstDataCol="1" rowPageCount="1" colPageCount="1"\/>/);
  assert.match(table, /<rowFields count="1"><field x="0"\/><\/rowFields><colFields count="2"><field x="1"\/><field x="-2"\/><\/colFields>/);
  assert.match(table, /<pageFields count="1"><pageField fld="3" hier="-1"\/><\/pageFields>/);
  assert.match(table, /<dataField name="Average of Amount" fld="2" subtotal="average"/);
  assert.match(table, /<item x="3" h="1"\/>/, "the excluded rep is hidden");
  assert.match(await read("xl/worksheets/_rels/sheet2.xml.rels"), /relationships\/pivotTable" Target="..\/pivotTables\/pivotTable1\.xml"/);
  assert.match(await read("[Content_Types].xml"), /pivotTable1\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.pivotTable\+xml"/);

  const back = await xlsxToUniver(bytes);
  const pivots = JSON.parse(back.resources!.find((r) => r.name === PIVOT_RESOURCE)!.data).pivots as PivotDef[];
  assert.equal(pivots.length, 1);
  const p = pivots[0];
  assert.deepEqual([p.name, p.source, p.target, p.rows, p.columns, p.values, p.filters], [
    "Pivot 1",
    { sheetId: "sheet-1", range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 3 } },
    { sheetId: "sheet-2", row: 2, column: 0 },
    ["Region"],
    ["Year"],
    def.values,
    def.filters,
  ]);
});

test("openpyxl and LibreOffice read the pivot table", { skip: !existsSync("/usr/bin/soffice") && "LibreOffice not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pivot-"));
  try {
    const file = path.join(dir, "p.xlsx");
    writeFileSync(file, await univerToXlsx(book()));
    // openpyxl parses the pivot parts against their schema classes.
    const py = execFileSync("python3", ["-c", "import sys,openpyxl;ws=openpyxl.load_workbook(sys.argv[1])['Pivot 1'];p=ws._pivots[0];print(p.name, p.cache.cacheSource.worksheetSource.ref, len(p.dataFields))", file]).toString().trim();
    assert.equal(py, "Pivot 1 A1:D6 2");
    // LibreOffice imports it as a pivot table (DataPilot) and writes it back out.
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/lo`, "--convert-to", "ods", "--outdir", dir, file], { stdio: "ignore", timeout: 120_000 });
    const ods = await JSZip.loadAsync(readFileSync(path.join(dir, "p.ods")));
    const content = await ods.file("content.xml")!.async("string");
    assert.match(content, /<table:data-pilot-table [^>]*table:name="Pivot 1"/);
    assert.match(content, /table:source-field-name="Region" table:orientation="row"/);
    assert.match(content, /table:source-field-name="Amount" tableooo:display-name="Average of Amount" table:orientation="data"[^>]*table:function="average"/);
    assert.match(content, /table:source-field-name="Rep" table:orientation="page"/);
    // A pivot table written by another program reads back too.
    const out = path.join(dir, "lo");
    execFileSync("soffice", ["--headless", `-env:UserInstallation=file://${dir}/lo`, "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, path.join(dir, "p.ods")], { stdio: "ignore", timeout: 120_000 });
    const again = await xlsxToUniver(readFileSync(path.join(out, "p.xlsx")));
    const pivots = JSON.parse(again.resources!.find((r) => r.name === PIVOT_RESOURCE)?.data || '{"pivots":[]}').pivots as PivotDef[];
    assert.equal(pivots.length, 1);
    assert.deepEqual([pivots[0].rows, pivots[0].columns, pivots[0].values.map((v) => v.agg)], [["Region"], ["Year"], ["sum", "average"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
