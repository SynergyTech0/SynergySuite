// Browser check for Docs tables and fields: table styles and style options,
// sort, a SUM formula, convert text to table and back, cell borders, Insert >
// Field (date, page count) and Insert > Symbol, and the .docx they produce.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-tables.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const cursorIn = (text, off = 0) =>
  page.evaluate(([t, o]) => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t);
    });
    ed.chain().focus().setTextSelection(at + o).run();
  }, [text, off]);
const json = () => page.evaluate(() => window.__docsEditor.getJSON());
const closed = (testid) => page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"]`), testid);
const cellTexts = (t) => t.content.map((r) => r.content.map((c) => (c.content?.[0]?.content || []).map((x) => x.text ?? x.attrs?.result ?? "").join("")));
const c = (t, type = "tableCell") => ({ type, attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) }] });
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(
    ([c1, rows]) =>
      window.__docsEditor.commands.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Sales" }] },
          { type: "table", content: [{ type: "tableRow", content: c1 }, ...rows.map((r) => ({ type: "tableRow", content: r }))] },
          { type: "paragraph", content: [{ type: "text", text: "red\t1" }] },
          { type: "paragraph", content: [{ type: "text", text: "blue\t2" }] },
          { type: "paragraph", content: [{ type: "text", text: "Date line: " }] },
        ],
      }),
    [
      [c("Fruit", "tableHeader"), c("Qty", "tableHeader")],
      [
        [c("pear"), c("10")],
        [c("apple"), c("7")],
        [c("fig"), c("25")],
        [c("Total"), c("")],
      ],
    ],
  );

  // table style and options
  await cursorIn("pear");
  await menu("Table", "Table styles", "Grid Table 4 Accent 1");
  await page.waitForSelector('.ProseMirror table[data-table-style="GridTable4-Accent1"][data-look-first-row][data-look-band-rows]');
  const headBg = await page.evaluate(() => getComputedStyle(document.querySelector(".ProseMirror table[data-table-style] tr:first-child > *")).backgroundColor);
  assert.equal(headBg, "rgb(68, 114, 196)");
  await menu("Table", "Table style options", "Banded rows");
  await page.waitForFunction(() => !document.querySelector(".ProseMirror table[data-look-band-rows]"));
  await menu("Table", "Table style options", "Total row");
  await page.waitForSelector(".ProseMirror table[data-look-last-row]");
  log("table style, header row, banded rows and total row");

  // formula in the total row
  await cursorIn("Total", 5);
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    const t = ed.state.doc.child(1);
    // the empty cell after "Total"
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "tableCell" && n.textContent === "" && pos < 0) pos = p;
    });
    ed.chain().focus().setTextSelection(pos + 2).run();
    return t.childCount;
  });
  await menu("Table", "Formula…");
  await page.getByLabel("Formula expression").fill("SUM(ABOVE)");
  await page.getByTestId("field-preview").filter({ hasText: "42" }).waitFor();
  await page.getByTestId("field-ok").click();
  await closed("field-ok");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-docfield")].some((e) => e.textContent === "42"));
  log("=SUM(ABOVE) gives 42");

  // sort by quantity, descending, keeping the header (the total row sorts too, as in Word)
  await cursorIn("pear");
  await menu("Table", "Sort…");
  await page.getByLabel("Sort key 1 column").selectOption("1");
  await page.getByLabel("Sort key 1 type").selectOption("number");
  await page.getByLabel("Sort key 1 order").selectOption("desc");
  await page.getByTestId("sort-ok").click();
  await closed("sort-ok");
  const sorted = cellTexts((await json()).content.find((n) => n.type === "table")).map((r) => r[0]);
  assert.deepEqual(sorted, ["Fruit", "Total", "fig", "pear", "apple"]);
  log("sort by number, descending, with a header row");

  // cell borders on a styled table
  await cursorIn("fig");
  await menu("Table", "Borders", "Bottom border");
  const figCell = (await json()).content.find((n) => n.type === "table").content[2].content[0];
  assert.match(JSON.parse(figCell.attrs.borders).bottom, /solid/);
  log("cell borders");

  // text to table and back
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let a = -1, b = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isText && n.text.startsWith("red")) a = pos;
      if (n.isText && n.text.startsWith("blue")) b = pos + n.text.length;
    });
    ed.chain().focus().setTextSelection({ from: a, to: b }).run();
  });
  await menu("Table", "Convert text to table", "Separate at tabs");
  await page.waitForFunction(() => window.__docsEditor.getJSON().content.filter((n) => n.type === "table").length === 2);
  assert.deepEqual(cellTexts((await json()).content.filter((n) => n.type === "table")[1]), [["red", "1"], ["blue", "2"]]);
  await cursorIn("blue");
  await menu("Table", "Convert table to text", "Separate with commas");
  await page.waitForFunction(() => window.__docsEditor.getJSON().content.filter((n) => n.type === "table").length === 1);
  assert.ok((await json()).content.some((n) => n.type === "paragraph" && n.content?.[0]?.text === "blue, 2"));
  log("convert text to table and back");

  // Insert > Field: a date with a picture, and the page count
  await cursorIn("Date line: ", 11);
  await menu("Insert", "Field…");
  await page.locator('[data-field-kind="DATE"]').click();
  await page.getByLabel("Date format").selectOption("yyyy-MM-dd");
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await page.getByTestId("field-preview").filter({ hasText: today }).waitFor();
  await page.getByTestId("field-ok").click();
  await closed("field-ok");
  await menu("Insert", "Field…");
  await page.locator('[data-field-kind="NUMPAGES"]').click();
  await page.getByTestId("field-ok").click();
  await closed("field-ok");
  await page.waitForFunction((d) => [...document.querySelectorAll(".ProseMirror .word-docfield")].map((e) => e.textContent).join("|").includes(d), today);
  log("date and page-count fields");

  // Insert > Symbol: special characters and the recently used row
  await menu("Insert", "Symbol…");
  await page.getByText("Special characters", { exact: true }).click();
  await page.locator('[data-special="Section"]').click();
  await page.getByTestId("symbol-insert").click();
  await page.getByText("Close", { exact: true }).click();
  assert.ok((await json()).content.some((n) => (n.content || []).some((x) => x.text?.includes("§"))));
  log("symbol inserted");

  // the .docx
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml").async("string");
  const styles = await zip.file("word/styles.xml").async("string");
  for (const re of [/<w:tblStyle w:val="GridTable4-Accent1"\/>/, /w:lastRow="1"/, /w:noHBand="1"/, / =SUM\(ABOVE\) /, /DATE \\@ &quot;yyyy-MM-dd&quot;/, / NUMPAGES /, new RegExp(`<w:t xml:space="preserve">${today}</w:t>`)]) assert.match(xml, re);
  assert.match(styles, /w:styleId="GridTable4-Accent1"/);
  log("saved in the .docx");
  console.log("docs tables e2e: all checks passed");
} finally {
  await browser.close();
}
