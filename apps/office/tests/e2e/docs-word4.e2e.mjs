// Browser check for milestone 4: document properties and fields that evaluate
// (DOCPROPERTY, IF), block content controls, the split window, combo charts,
// pictures and tables in headers, printing page for page, and split blocks
// under mirror margins.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-word4.e2e.mjs
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
let promptAnswer = "";
page.on("dialog", (d) => d.accept(promptAnswer));
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const nodes = (type) =>
  page.evaluate((t) => {
    const out = [];
    window.__docsEditor.state.doc.descendants((n) => {
      if (n.type.name === t) out.push({ attrs: n.attrs, text: n.textContent, children: n.childCount });
    });
    return out;
  }, type);
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function mirrorDocx() {
  const zip = new JSZip();
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>');
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/settings" Target="settings.xml"/></Relationships>`);
  zip.file("word/settings.xml", `<?xml version="1.0"?><w:settings ${W}><w:mirrorMargins/></w:settings>`);
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
  const fill = Array.from({ length: 14 }, (_, i) => `<w:p><w:r><w:t>Filler paragraph ${i + 1}.</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document ${W}><w:body>${fill}<w:p><w:r><w:t xml:space="preserve">${words}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="2160" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return [...(await zip.generateAsync({ type: "uint8array" }))];
}

try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Word 4" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate((c) => window.__docsEditor.chain().focus().setContent(c).setTextSelection(6).run(), {
    type: "doc",
    content: [para("Intro"), para("First clause."), para("Second clause."), para("End")],
  });

  // ---- File > Properties, then DOCPROPERTY and IF fields that evaluate ----
  await menu("File", "Properties…");
  await page.getByLabel("Company").fill("Synergy");
  await page.getByTestId("properties-add").click();
  await page.getByLabel("Custom name 1").fill("Client");
  await page.getByLabel("Custom value 1").fill("Acme");
  await page.getByTestId("properties-ok").click();
  await page.waitForFunction(() => window.__docsState().settings.customProperties?.Client === "Acme");
  await menu("Insert", "Field…");
  await page.locator('[data-field-kind="DOCPROPERTY"]').click();
  await page.getByLabel("Field code").fill("DOCPROPERTY Client");
  await page.waitForFunction(() => document.querySelector("[data-testid=field-preview]")?.textContent === "Acme");
  await page.getByLabel("Field code").fill('IF { DOCPROPERTY Company } = "Synergy" "Ours" "Theirs"');
  await page.waitForFunction(() => document.querySelector("[data-testid=field-preview]")?.textContent === "Ours");
  await page.getByTestId("field-ok").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-docfield, .ProseMirror [data-field]")].some((e) => e.textContent.includes("Ours")) || document.querySelector(".ProseMirror").textContent.includes("Ours"));
  let fields = await nodes("docField");
  assert.equal(fields.length, 1);
  assert.match(fields[0].attrs.instr, /^IF \{ DOCPROPERTY Company \}/);
  // changing the property updates the field
  await menu("File", "Properties…");
  await page.getByLabel("Company").fill("Other");
  await page.getByTestId("properties-ok").click();
  await page.waitForFunction(() => document.querySelector(".ProseMirror").textContent.includes("Theirs"), null, { timeout: 10000 });
  let bytes = await page.evaluate(() => window.__docsExportBytes());
  let zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.match(await zip.file("docProps/custom.xml").async("string"), /name="Client"><vt:lpwstr>Acme/);
  assert.match(await zip.file("docProps/app.xml").async("string"), /<Company>Other<\/Company>/);
  const docXml = await zip.file("word/document.xml").async("string");
  assert.equal((docXml.match(/fldCharType="begin"/g) || []).length, 2, "the nested DOCPROPERTY is a field of its own");
  log("properties, DOCPROPERTY and IF fields");

  // ---- block content control around two paragraphs ----
  const range = await page.evaluate(() => {
    const d = window.__docsEditor.state.doc;
    let a = -1;
    let b = -1;
    d.forEach((n, off) => {
      if (n.textContent === "First clause.") a = off + 1;
      if (n.textContent === "Second clause.") b = off + n.nodeSize - 1;
    });
    return { a, b };
  });
  await page.evaluate(({ a, b }) => window.__docsEditor.chain().focus().setTextSelection({ from: a, to: b }).run(), range);
  promptAnswer = "Terms";
  await menu("Insert", "Content control", "Group the selected paragraphs (block control)");
  await page.waitForSelector(".ProseMirror div[data-block-cc]");
  const blocks = await nodes("blockControl");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].attrs.title, "Terms");
  assert.equal(blocks[0].children, 2);
  assert.ok(await page.evaluate(() => !!document.querySelector(".ProseMirror .word-bcc.word-bcc-active")), "the control around the cursor is framed");
  bytes = await page.evaluate(() => window.__docsExportBytes());
  zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.match(await zip.file("word/document.xml").async("string"), /<w:sdt><w:sdtPr><w:alias w:val="Terms"\/>.*?<w:sdtContent><w:p>.*First clause\..*Second clause\..*<\/w:sdtContent><\/w:sdt>/);
  log("block content control");

  // ---- split window: a second pane on the same text ----
  await menu("View", "Split");
  await page.waitForSelector("[data-testid=split-pane-editor]");
  assert.ok((await page.locator("[data-testid=split-pane-editor]").textContent()).includes("Second clause."));
  // typing in the lower pane edits the document
  await page.evaluate(() => {
    const el = document.querySelector("[data-testid=split-pane-editor]");
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) if (t.textContent.includes("End")) break;
    const r = document.createRange();
    r.setStart(t, t.textContent.length);
    r.collapse(true);
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.type(" typed below");
  await page.waitForFunction(() => window.__docsEditor.getText().includes("End typed below"));
  // and the upper pane's edits show below
  await page.evaluate(() => window.__docsEditor.chain().insertContentAt(1, "Top ").run());
  await page.waitForFunction(() => document.querySelector("[data-testid=split-pane-editor]").textContent.includes("Top Intro"));
  // the panes scroll on their own
  const scrolls = await page.evaluate(() => {
    const lower = document.querySelector("[data-testid=split-pane] .overflow-auto");
    const upper = document.querySelector("main.overflow-auto");
    return { lower: !!lower, upper: !!upper, different: lower !== upper };
  });
  assert.ok(scrolls.lower && scrolls.upper && scrolls.different);
  await page.getByTestId("split-close").click();
  await page.waitForSelector("[data-testid=split-pane]", { state: "detached" });
  log("split window");

  // ---- combo chart: one series drawn as a line ----
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(3).run());
  await menu("Insert", "Chart…");
  await page.getByLabel("Chart data").fill("\tSales\tTrend\nQ1\t5\t4\nQ2\t8\t6\nQ3\t6\t7");
  await page.getByTestId("chart-series-type-1").selectOption("line");
  await page.getByTestId("chart-series-y2-1").check();
  await page.getByTestId("chart-ok").click();
  const charts = await nodes("wordChart");
  const data = JSON.parse(charts[0].attrs.chart);
  assert.equal(data.series[1].type, "line");
  assert.equal(data.series[1].y2, true);
  bytes = await page.evaluate(() => window.__docsExportBytes());
  zip = await JSZip.loadAsync(Buffer.from(bytes));
  const chartPart = Object.keys(zip.files).find((f) => /^word\/charts\/chart\d+\.xml$/.test(f));
  const chartXml = await zip.file(chartPart).async("string");
  assert.match(chartXml, /<c:barChart>/);
  assert.match(chartXml, /<c:lineChart>/);
  assert.equal((chartXml.match(/<c:valAx>/g) || []).length, 2);
  log("combo chart");

  // ---- header with a picture and a table ----
  await menu("Insert", "Header and footer…");
  await page.waitForSelector("[data-testid=hf-editor] .ProseMirror");
  await page.locator("[data-testid=hf-editor] .ProseMirror").click();
  await page.getByTestId("hf-table").click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("hf-picture-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await page.waitForSelector("[data-testid=hf-editor] img");
  await page.getByText("Save", { exact: true }).click();
  await page.waitForFunction(() => {
    const h = window.__docsState().body.headers?.default;
    const s = JSON.stringify(h || {});
    return s.includes('"table"') && s.includes('"image"');
  });
  await page.waitForSelector(".pl-hf img");
  bytes = await page.evaluate(() => window.__docsExportBytes());
  zip = await JSZip.loadAsync(Buffer.from(bytes));
  const hdr = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f));
  const hx = await zip.file(hdr).async("string");
  assert.match(hx, /<w:tbl>/);
  assert.match(hx, /<w:drawing>/);
  log("picture and table in the header");

  // ---- Ctrl+P prints page for page: no gaps, paper the size of the page ----
  await page.evaluate(() => window.__docsEditor.chain().focus().insertContentAt(window.__docsEditor.state.doc.content.size, Array.from({ length: 70 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `Line ${i}` }] }))).run());
  await page.waitForFunction(() => (window.__docsLayout()?.pages.length || 0) >= 2);
  await page.evaluate(() => {
    window.print = () => {
      const pages = [...document.querySelectorAll(".pl-page")].map((p) => ({ top: parseFloat(p.style.top), height: parseFloat(p.style.height) }));
      window.__printed = { printing: document.documentElement.classList.contains("docs-printing"), css: document.querySelector("style[data-docs-print]")?.textContent || "", pages };
    };
  });
  await page.locator(".ProseMirror.pl-root").click();
  await page.keyboard.press("Control+p");
  await page.waitForFunction(() => !!window.__printed);
  const printed = await page.evaluate(() => window.__printed);
  assert.ok(printed.printing);
  assert.match(printed.css, /@page \{ size: 612pt 792pt; margin: 0; \}/);
  assert.ok(printed.pages.length >= 2);
  for (let k = 1; k < printed.pages.length; k++) assert.ok(Math.abs(printed.pages[k].top - (printed.pages[k - 1].top + printed.pages[k - 1].height)) < 1, `page ${k + 1} follows page ${k} with no gap: ${JSON.stringify(printed.pages.slice(0, 3))}`);
  await page.waitForFunction(() => !document.documentElement.classList.contains("docs-printing"));
  const gapBack = await page.evaluate(() => {
    const p = window.__docsLayout().pages;
    return p[1].top - (p[0].top + p[0].height);
  });
  assert.ok(gapBack > 5, "the gap between pages comes back after printing");
  log(`printing (${printed.pages.length} pages, no gaps)`);

  // ---- mirror margins: the rest of a split paragraph moves to the even page's margin ----
  await page.evaluate((b) => window.__docsOpenBytes(b), await mirrorDocx());
  await page.waitForFunction(() => (window.__docsLayout()?.pages.length || 0) >= 2 && window.__docsLayout().splits.length >= 1, null, { timeout: 20000 });
  await page.waitForSelector("[data-pl-shift]", { state: "attached" });
  const lefts = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".pl-page")].map((p) => p.getBoundingClientRect());
    const big = [...document.querySelectorAll(".ProseMirror > p")].find((p) => p.textContent.startsWith("word0"));
    const rects = [];
    const walker = document.createTreeWalker(big, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const r = document.createRange();
      r.selectNodeContents(t);
      rects.push(...[...r.getClientRects()].map((x) => ({ left: x.left, top: x.top })));
    }
    const on = (k) => rects.filter((r) => r.top >= pages[k].top && r.top < pages[k].bottom);
    const first = on(0);
    const second = on(1);
    const zoom = pages[0].width / 816;
    return { p1: Math.min(...first.map((r) => r.left)) - pages[0].left, p2: Math.min(...second.map((r) => r.left)) - pages[1].left, n1: first.length, n2: second.length, zoom };
  });
  assert.ok(lefts.n1 > 0 && lefts.n2 > 0, JSON.stringify(lefts));
  // inside margin 1.5 in on page 1 (left), outside margin 0.75 in on page 2 (left, mirrored)
  assert.ok(Math.abs(lefts.p1 / lefts.zoom - 144) < 4, `page 1 text at the inside margin: ${JSON.stringify(lefts)}`);
  assert.ok(Math.abs(lefts.p2 / lefts.zoom - 72) < 4, `page 2 text at its mirrored margin: ${JSON.stringify(lefts)}`);
  log("split paragraph follows mirror margins");

  console.log("docs-word4 e2e: all passed");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-word4-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
