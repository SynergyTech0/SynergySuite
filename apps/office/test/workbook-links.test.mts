// Links to other workbooks: names in formulas, the values kept with a link,
// and Excel's external link parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { cacheOf, formulaLinksFromExcel, formulaLinksToExcel, linkNameFor, linkNamesIn, LINKS_RESOURCE, readExternalLinkXml, externalLinkXml, unitFromCache, type WorkbookLink } from "../lib/workbook-links.ts";
import { univerToXlsx, xlsxToUniver, type UniverWorkbook } from "../lib/xlsx.ts";

test("formulas name linked workbooks in brackets", () => {
  assert.deepEqual(linkNamesIn("=[Budget]Plan!A1+SUM('[Sales 2024]Q 1'!B1:B3)"), ["Budget", "Sales 2024"]);
  assert.deepEqual(linkNamesIn('=A1&"[Budget]Plan!A1"'), [], "not inside text");
  assert.deepEqual(linkNamesIn("=SUM(Table1[Amount])"), [], "table columns are not links");
  assert.equal(linkNameFor("Q1 [draft]: costs", ["Q1 draft costs"]), "Q1 draft costs 2");
  assert.equal(formulaLinksToExcel("[Budget]Plan!A1+'[Sales 2024]Q 1'!B1+'[Budget]Plan'!C1", (n) => ({ budget: 1, "sales 2024": 2 })[n.toLowerCase()]), "[1]Plan!A1+'[2]Q 1'!B1+[1]Plan!C1");
  assert.equal(formulaLinksFromExcel("[1]Plan!A1+'[2]Q 1'!B1+[2]Plan!C1", (i) => ["", "Budget", "Sales 2024"][i]), "[Budget]Plan!A1+'[Sales 2024]Q 1'!B1+'[Sales 2024]Plan'!C1");
});

test("a link keeps the other workbook's values, as Excel's external link part has them", () => {
  const cache = cacheOf({ sheetOrder: ["a"], sheets: { a: { name: "Plan", cellData: { 0: { 0: { v: 42 }, 1: { v: "Rent & rates" } }, 2: { 3: { v: true } } } } } });
  assert.deepEqual(cache, { sheets: [{ name: "Plan", cells: { 0: { 0: 42, 1: "Rent & rates" }, 2: { 3: true } } }] });
  const link: WorkbookLink = { name: "Budget", title: "Budget", docId: "d1", updated: 1, cache };
  const xml = externalLinkXml(link);
  assert.match(xml, /<cell r="B1" t="str"><v>Rent &amp; rates<\/v><\/cell>/);
  assert.deepEqual(readExternalLinkXml(xml), cache);
  const unit: any = unitFromCache(link);
  assert.equal(unit.id, "Budget");
  assert.deepEqual(unit.sheets.s0.cellData[0][0], { v: 42, t: 2 });
});

test("linked formulas and their values go through .xlsx", async () => {
  const link: WorkbookLink = { name: "Budget 2025", title: "Budget 2025", docId: "d1", updated: 1, cache: { sheets: [{ name: "Plan", cells: { 0: { 0: 42 } } }] } };
  const book: UniverWorkbook = {
    id: "wb",
    name: "Links",
    appVersion: "",
    locale: "enUS",
    sheetOrder: ["s"],
    styles: {},
    sheets: { s: { id: "s", name: "S", cellData: { 0: { 0: { f: "='[Budget 2025]Plan'!A1*2", v: 84, t: 2 } } } } as any },
    resources: [{ name: LINKS_RESOURCE, data: JSON.stringify({ links: [link] }) }],
  };
  const bytes = await univerToXlsx(book);
  const zip = await JSZip.loadAsync(bytes);
  assert.match(await zip.file("xl/worksheets/sheet1.xml")!.async("string"), /<f>\[1\]Plan!A1\*2<\/f>/);
  assert.match(await zip.file("xl/workbook.xml")!.async("string"), /<\/sheets><externalReferences><externalReference r:id="rIdLink1"\/><\/externalReferences>/);
  assert.match(await zip.file("xl/externalLinks/_rels/externalLink1.xml.rels")!.async("string"), /Target="Budget 2025.xlsx" TargetMode="External"/);
  const back = await xlsxToUniver(bytes, "Links");
  assert.equal((back.sheets[back.sheetOrder[0]].cellData as any)[0][0].f, "='[Budget 2025]Plan'!A1*2");
  const links = JSON.parse(back.resources!.find((r) => r.name === LINKS_RESOURCE)!.data).links;
  assert.equal(links[0].name, "Budget 2025");
  assert.equal(links[0].file, "Budget 2025.xlsx");
  assert.deepEqual(links[0].cache, link.cache);
});
