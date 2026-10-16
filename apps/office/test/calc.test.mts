// Dynamic arrays and calculation settings in .xlsx: LET/LAMBDA names, spill
// references, array formulas marked as dynamic arrays with their spilled
// values, and iterative calculation in calcPr.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { formulaFromExcel, formulaToExcel, univerToXlsx, xlsxToUniver, type UniverWorkbook } from "../lib/xlsx.ts";
import { CALC_RESOURCE, markDynamicArrays, patchCalcPr, readCalcPr, spillRefsToAnchorArray } from "../lib/xlsx-calc.ts";

test("LET and LAMBDA names carry Excel's _xlpm. prefix, and come back without it", () => {
  const f = "=LET(rate,B1,total,SUM(A1:A3),total*rate)";
  assert.equal(formulaToExcel(f), "_xlfn.LET(_xlpm.rate,B1,_xlpm.total,SUM(A1:A3),_xlpm.total*_xlpm.rate)");
  assert.equal(formulaFromExcel(formulaToExcel(f)), f);
  assert.equal(formulaToExcel("=MAP(A1:A3,LAMBDA(v,v*2))"), "_xlfn.MAP(A1:A3,_xlfn.LAMBDA(_xlpm.v,_xlpm.v*2))");
  // Names inside strings and sheet names stay as they are.
  assert.equal(formulaToExcel('=LET(x,1,x&"x")'), '_xlfn.LET(_xlpm.x,1,_xlpm.x&"x")');
  assert.equal(formulaToExcel("=SUM(A1:A3)"), "SUM(A1:A3)");
});

test("spill references are ANCHORARRAY calls", () => {
  assert.equal(spillRefsToAnchorArray("=SUM(C1#)+COUNT(Data!$D$2#)"), "=SUM(ANCHORARRAY(C1))+COUNT(ANCHORARRAY(Data!$D$2))");
  assert.equal(spillRefsToAnchorArray("=SUM('My data'!A1#)&\"A1#\""), "=SUM(ANCHORARRAY('My data'!A1))&\"A1#\"");
  assert.equal(formulaToExcel("=SUM(ANCHORARRAY(C1))"), "SUM(_xlfn.ANCHORARRAY(C1))");
});

test("iterative calculation settings live in calcPr", () => {
  const wb = '<workbook><sheets><sheet name="A"/></sheets><calcPr calcId="191029"/></workbook>';
  const out = patchCalcPr(wb, { iterate: true, maxIterations: 50, maxChange: 0.01 }, true);
  assert.match(out, /<calcPr calcId="191029" iterate="1" iterateCount="50" iterateDelta="0.01" fullCalcOnLoad="1"\/>/);
  assert.deepEqual(readCalcPr(out), { iterate: true, maxIterations: 50, maxChange: 0.01 });
  assert.equal(readCalcPr(wb), null);
  assert.match(patchCalcPr("<workbook><sheets/></workbook>".replace("<sheets/>", "<sheets></sheets>"), { iterate: true, maxIterations: 100, maxChange: 0.001 }, false), /<\/sheets><calcPr calcId="191029" iterate="1"/);
  assert.equal(markDynamicArrays('<c r="A1"><f t="array" ref="A1:A3">x</f></c><c r="B1"><f>y</f></c>'), '<c r="A1" cm="1"><f t="array" ref="A1:A3">x</f></c><c r="B1"><f>y</f></c>');
});

test("a spilling formula goes to .xlsx as a dynamic array and comes back spilling", async () => {
  const book: UniverWorkbook = {
    id: "wb",
    name: "Spill",
    appVersion: "",
    locale: "enUS",
    sheetOrder: ["s"],
    styles: {},
    sheets: {
      s: {
        id: "s",
        name: "Data",
        rowCount: 20,
        columnCount: 10,
        cellData: {
          0: { 0: { v: 3, t: 2 }, 2: { f: "=SORT(UNIQUE(A1:A4))", v: 1, t: 2 }, 4: { f: "=SUM(ANCHORARRAY(C1))", v: 6, t: 2 } },
          1: { 0: { v: 1, t: 2 } },
          2: { 0: { v: 2, t: 2 } },
          3: { 0: { v: 3, t: 2 } },
        },
      } as any,
    },
    resources: [{ name: CALC_RESOURCE, data: JSON.stringify({ iterate: true, maxIterations: 10, maxChange: 0.5 }) }],
  };
  const spills = { s: { spills: [{ row: 0, column: 2, endRow: 2, endColumn: 2 }], values: { 0: { 2: 1 }, 1: { 2: 2 }, 2: { 2: 3 } } } };
  const bytes = await univerToXlsx(book, { spills });
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheet, /<c r="C1" cm="1"><f t="array" ref="C1:C3">_xlfn._xlws.SORT\(_xlfn.UNIQUE\(A1:A4\)\)<\/f><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="C2"><v>2<\/v><\/c>/, "the spilled cells hold their values");
  assert.match(sheet, /<f>SUM\(_xlfn.ANCHORARRAY\(C1\)\)<\/f>/);
  assert.ok(zip.file("xl/metadata.xml"), "the dynamic-array metadata part");
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /PartName="\/xl\/metadata.xml"/);
  assert.match(await zip.file("xl/_rels/workbook.xml.rels")!.async("string"), /relationships\/sheetMetadata" Target="metadata.xml"/);
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /iterate="1" iterateCount="10" iterateDelta="0.5" fullCalcOnLoad="1"/);

  const back = await xlsxToUniver(bytes, "Spill");
  const cells = back.sheets[back.sheetOrder[0]].cellData as any;
  assert.equal(cells[0][2].f, "=SORT(UNIQUE(A1:A4))");
  assert.equal(cells[1]?.[2], undefined, "the spilled values are left for the formula to fill");
  assert.equal(cells[0][4].f, "=SUM(ANCHORARRAY(C1))");
  assert.deepEqual(JSON.parse(back.resources!.find((r) => r.name === CALC_RESOURCE)!.data), { iterate: true, maxIterations: 10, maxChange: 0.5 });
});
