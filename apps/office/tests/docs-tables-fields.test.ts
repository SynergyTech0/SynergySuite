// Table styles, sort and convert; document fields (dates, counts, formulas)
// and their round trip through .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { sortTable, textToTable, tableToText, tblLookXml, readTblLook, guessSeparator, lookOf, tableStylesCss, type TableLook } from "../lib/docs/tables";
import { fieldKind, fieldResult, formatDate, formatNumber, evalFormula } from "../lib/docs/doc-fields";
import { buildDocx } from "../lib/docs/docx-export";
import { importDocx } from "../lib/docs/docx-import";
import type { PMNode } from "../lib/docs/model";

const p = (t: string): PMNode => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const cell = (t: string, type = "tableCell"): PMNode => ({ type, attrs: { colspan: 1, rowspan: 1 }, content: [p(t)] });
const row = (...ts: string[]): PMNode => ({ type: "tableRow", content: ts.map((t) => cell(t)) });

test("sort rows by text, number and date with a header", () => {
  const t: PMNode = { type: "table", content: [row("Name", "Qty", "When"), row("pear", "10", "2024-03-01"), row("Apple", "9", "2023-01-05"), row("fig", "100", "2025-07-09")] };
  const names = (x: PMNode) => (x.content || []).map((r) => (r.content![0].content![0].content?.[0]?.text || ""));
  assert.deepEqual(names(sortTable(t, [{ col: 0, type: "text" }], true)), ["Name", "Apple", "fig", "pear"]);
  assert.deepEqual(names(sortTable(t, [{ col: 1, type: "number", desc: true }], true)), ["Name", "fig", "pear", "Apple"]);
  assert.deepEqual(names(sortTable(t, [{ col: 2, type: "date" }], true)), ["Name", "Apple", "pear", "fig"]);
  // a merged column blocks the sort
  const merged: PMNode = { ...t, content: [...t.content!.slice(0, 1), { type: "tableRow", content: [{ ...cell("x"), attrs: { colspan: 1, rowspan: 2 } }, cell("1"), cell("2")] }, row("a", "b")] };
  assert.equal(sortTable(merged, [{ col: 1, type: "text" }], true), merged);
});

test("text to table and back", () => {
  assert.equal(guessSeparator(["a\tb", "c\td"]), "tab");
  assert.equal(guessSeparator(["a,b", "c,d"]), "comma");
  const t = textToTable([p("a\tb\tc"), p("d\te")], "tab");
  assert.equal(t.content!.length, 2);
  assert.equal(t.content![1].content!.length, 3);
  assert.deepEqual(tableToText(t, "comma").map((x) => x.content?.[0]?.text), ["a, b, c", "d, e"]);
  assert.equal(tableToText(t, "paragraph").length, 5);
});

test("table look flags round-trip through tblLook", () => {
  const look: TableLook = { firstRow: true, lastRow: true, firstColumn: false, lastColumn: false, bandedRows: false, bandedColumns: true };
  const attrs = Object.fromEntries([...tblLookXml(look).matchAll(/w:(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(readTblLook(attrs), look);
  assert.deepEqual(readTblLook({ val: "04A0" }), { firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, bandedRows: true, bandedColumns: false });
  assert.equal(lookOf(null).firstRow, true);
  assert.match(tableStylesCss(".x"), /table\[data-table-style="GridTable4-Accent1"\]\[data-look-first-row\]/);
});

test("date, number and text pictures", () => {
  const d = new Date(2024, 2, 5, 14, 7, 9);
  assert.equal(formatDate(d, "dddd, MMMM d, yyyy"), "Tuesday, March 5, 2024");
  assert.equal(formatDate(d, "yyyy-MM-dd HH:mm"), "2024-03-05 14:07");
  assert.equal(formatDate(d, "h:mm am/pm"), "2:07 pm");
  assert.equal(formatNumber(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(formatNumber(-3, "$#,##0.00;($#,##0.00)"), "($3.00)");
  assert.equal(formatNumber(0.256, "0%"), "26%");
  const ctx = { now: d, title: "Plan", author: "Ann Lee", pages: 7, words: 12, filename: "Plan" };
  assert.equal(fieldResult('DATE \\@ "d MMMM yyyy"', ctx), "5 March 2024");
  assert.equal(fieldResult("NUMPAGES", ctx), "7");
  assert.equal(fieldResult("AUTHOR \\* Upper", ctx), "ANN LEE");
  assert.equal(fieldResult("FILENAME", ctx), "Plan.docx");
  assert.equal(fieldResult("NUMWORDS", ctx), "12");
  assert.equal(fieldKind(" = SUM(ABOVE) "), "=");
  assert.equal(fieldKind("REF x"), null);
});

test("table formulas", () => {
  const table = { cells: [["Item", "Q1", "Q2"], ["a", "10", "$1,000.50"], ["b", "5", "20"], ["Total", "", ""]], row: 3, col: 1 };
  assert.equal(evalFormula("SUM(ABOVE)", table), 15);
  assert.equal(evalFormula("SUM(ABOVE)", { ...table, col: 2 }), 1020.5);
  assert.equal(evalFormula("AVERAGE(B2:B3)", table), 7.5);
  assert.equal(evalFormula("MAX(B2:C3)*2", table), 2001);
  assert.equal(evalFormula("IF(B2>B3,1,0)+ROUND(2.567,1)", table), 3.6);
  assert.equal(evalFormula("SUM(LEFT)", { cells: [["1", "2", "x"]], row: 0, col: 2 }), 3);
  assert.equal(fieldResult('=SUM(ABOVE) \\# "#,##0.00"', { now: new Date(), table }), "15.00");
  assert.equal(fieldResult("=1/(", { now: new Date() }), "!Syntax Error");
});

test("table styles and fields round-trip through .docx", async () => {
  const doc: PMNode = {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { tableStyle: "GridTable4-Accent1", look: JSON.stringify({ firstRow: true, lastRow: true, bandedRows: false }), align: "center" },
        content: [{ type: "tableRow", content: [cell("H1", "tableHeader"), cell("H2", "tableHeader")] }, row("1", "2"), row("3", "4")],
      },
      { type: "paragraph", content: [{ type: "text", text: "Printed " }, { type: "docField", attrs: { instr: 'DATE \\@ "yyyy-MM-dd"', result: "2024-03-05" } }, { type: "text", text: " of " }, { type: "docField", attrs: { instr: "NUMPAGES", result: "3" } }] },
    ],
  };
  const bytes = await buildDocx({ doc });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const styles = await zip.file("word/styles.xml")!.async("string");
  assert.match(xml, /<w:tblStyle w:val="GridTable4-Accent1"\/>/);
  assert.match(xml, /w:lastRow="1"/);
  assert.match(xml, /w:noHBand="1"/);
  assert.match(xml, /<w:tblW [^>]*\/><w:jc w:val="center"\/>/);
  assert.match(styles, /w:styleId="GridTable4-Accent1"/);
  assert.match(styles, /w:styleId="TableNormal"/);
  assert.match(xml, /DATE \\@ &quot;yyyy-MM-dd&quot;/);
  assert.match(xml, /<w:t xml:space="preserve">2024-03-05<\/w:t>/);
  const back = (await importDocx(bytes)).doc.content!;
  const t = back.find((n) => n.type === "table")!;
  assert.equal(t.attrs?.tableStyle, "GridTable4-Accent1");
  assert.equal(t.attrs?.align, "center");
  assert.equal(lookOf(t.attrs?.look).lastRow, true);
  assert.equal(lookOf(t.attrs?.look).bandedRows, false);
  // a styled table leaves borders to the style
  assert.equal(t.content![1].content![0].attrs?.borders ?? null, null);
  const para = back.find((n) => n.type === "paragraph" && (n.content || []).some((c) => c.type === "docField"))!;
  const fields = para.content!.filter((c) => c.type === "docField");
  assert.deepEqual(
    fields.map((f) => [f.attrs?.instr, f.attrs?.result]),
    [
      ['DATE \\@ "yyyy-MM-dd"', "2024-03-05"],
      ["NUMPAGES", "3"],
    ],
  );
  assert.deepEqual(para.content!.filter((c) => c.type === "text").map((c) => c.text), ["Printed ", " of "]);
});
