// Printing: page setup, pagination, headers/footers and the HTML/PDF output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headerFooterText, layoutPageCount, parseArea, printSheet, printWorkbook } from "../lib/sheet-print.ts";
import { pagesToHtml } from "../lib/print-html.ts";
import { pagesToPdf } from "../lib/print-pdf.ts";
import type { UniverWorkbook } from "../lib/xlsx.ts";

function book(rows: number, cols: number, pageSetup?: Record<string, unknown>, headerFooter?: Record<string, unknown>): UniverWorkbook {
  const cellData: Record<number, Record<number, { v: string | number; t: number; s?: string }>> = {};
  for (let r = 0; r < rows; r++) {
    cellData[r] = {};
    for (let c = 0; c < cols; c++) cellData[r][c] = r === 0 ? { v: `H${c + 1}`, t: 1, s: "bold" } : { v: r * 10 + c, t: 2, s: c === 1 ? "money" : undefined as any };
  }
  return {
    id: "b", name: "Report", appVersion: "", locale: "enUS", sheetOrder: ["s1"], resources: [],
    styles: { bold: { bl: 1 }, money: { n: { pattern: "$#,##0.00" } } },
    sheets: {
      s1: {
        id: "s1", name: "Data", rowCount: 1000, columnCount: 26, cellData,
        defaultRowHeight: 20, defaultColumnWidth: 64,
        ...(pageSetup || headerFooter ? { custom: { xlsx: { ...(pageSetup ? { pageSetup } : {}), ...(headerFooter ? { headerFooter } : {}) } } } : {}),
      },
    },
  };
}

test("rows flow onto as many Letter pages as they need", () => {
  // 684pt of printable height / 15pt rows = 45 rows a page.
  assert.equal(layoutPageCount(book(100, 3), "s1"), 3);
  const pages = printSheet(book(100, 3), "s1");
  assert.equal(pages[0].width, 612);
  assert.equal(pages[0].cells.filter((c) => c.x === 0.7 * 72 && c.text).length, 45);
  const money = pages[0].cells.find((c) => c.text.startsWith("$"));
  assert.equal(money?.text, "$11.00");
  assert.equal(money?.align, "right");
  assert.equal(pages[0].cells.find((c) => c.text === "H1")?.style.bold, true);
});

test("landscape, fit to one page wide, and print areas", () => {
  const wide = book(10, 30, { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
  const pages = printSheet(wide, "s1");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 792);
  const right = Math.max(...pages[0].cells.map((c) => c.x + c.w));
  assert.ok(right <= 792 - 0.7 * 72 + 0.01, `content fits: ${right}`);

  const area = printSheet(book(100, 10, { printArea: "B2:C5" }), "s1");
  assert.equal(area.length, 1);
  assert.deepEqual(area[0].cells.map((c) => c.text), ["$11.00", "12", "$21.00", "22", "$31.00", "32", "$41.00", "42"]);
  assert.deepEqual(parseArea("$A$1:$D$20"), { startRow: 0, endRow: 19, startColumn: 0, endColumn: 3 });
});

test("title rows repeat, scale applies, gridlines and headings print", () => {
  const pages = printSheet(book(100, 3, { printTitlesRow: "1:1", scale: 50, showGridLines: true, showRowColHeaders: true }), "s1");
  assert.equal(pages.length, 2, "half size fits twice the rows");
  const second = pages[1].cells.filter((c) => !c.heading);
  assert.equal(second[0].text, "H1", "the header row starts page 2");
  assert.equal(second[0].style.size, 5.5);
  assert.ok(pages[1].grid.length > 10);
  assert.ok(pages[0].cells.some((c) => c.heading && c.text === "A"));
});

test("header and footer codes", () => {
  const vars = { page: 2, pages: 5, sheet: "Data", file: "Report", now: new Date(2026, 0, 2) };
  assert.deepEqual(headerFooterText('&L&"Arial,Bold"&14&A&CPage &P of &N&R&F && co', vars), { left: "Data", center: "Page 2 of 5", right: "Report & co" });
  const pages = printWorkbook(book(100, 3, undefined, { oddFooter: "&CPage &P of &N" }));
  assert.deepEqual(pages.map((p) => p.footer.center), ["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"]);
});

test("HTML for the print dialog sets the paper and one box per page", () => {
  const html = pagesToHtml(printSheet(book(100, 3, { orientation: "landscape" }), "s1"), "Report");
  assert.match(html, /@page p0\{size:792pt 612pt;margin:0\}/);
  assert.equal(html.match(/class="sheet-page"/g)?.length, 4, "33 rows fit a landscape page");
  assert.match(html, /\$11\.00/);
});

test("PDF has a page per printed page at the paper size", async () => {
  const pdf = await pagesToPdf(printSheet(book(100, 3, { paperSize: 9 }), "s1"), "Report");
  const text = new TextDecoder("latin1").decode(pdf);
  assert.ok(text.startsWith("%PDF-"));
  assert.equal(text.match(/\/Type \/Page\b(?!s)/g)?.length, 3);
  assert.match(text, /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/, "A4");
});
