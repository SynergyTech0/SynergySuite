// Browser check for charts and SmartArt: inserted from their dialogs, drawn
// in the page, edited by double-click, resized, and kept through .docx.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-graphics.e2e.mjs
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
const nodes = (type) => page.evaluate((t) => {
  const out = [];
  window.__docsEditor.state.doc.descendants((n) => {
    if (n.type.name === t) out.push(n.attrs);
  });
  return out;
}, type);
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Graphics" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() => window.__docsEditor.chain().focus().setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Results" }] }, { type: "paragraph" }] }).setTextSelection(10).run());

  // ---- chart ----
  await menu("Insert", "Chart…");
  await page.getByLabel("Chart type").selectOption("line");
  await page.getByLabel("Chart title").fill("Visitors");
  await page.getByLabel("Chart data").fill("\tWeb\tStore\nMon\t5\t2\nTue\t8\t3\nWed\t6\t4");
  await page.waitForFunction(() => document.querySelector("[data-testid=chart-preview] svg")?.getAttribute("aria-label")?.includes("Visitors"));
  await page.getByTestId("chart-ok").click();
  await page.waitForSelector(".ProseMirror .word-chart svg");
  let charts = await nodes("wordChart");
  assert.equal(charts.length, 1);
  let c = JSON.parse(charts[0].chart);
  assert.equal(c.chartType, "line");
  assert.deepEqual(c.series.map((s) => s.values), [[5, 8, 6], [2, 3, 4]]);
  assert.match(await page.locator(".ProseMirror .word-chart svg").getAttribute("aria-label"), /line chart: Visitors/);
  assert.ok((await page.locator(".ProseMirror .word-chart svg path, .ProseMirror .word-chart svg polyline").count()) > 0, "lines drawn");
  log("chart inserted and drawn");

  // edit: double-click, change to a bar chart
  await page.locator(".ProseMirror .word-chart").dblclick();
  await page.getByLabel("Chart type").selectOption("bar");
  await page.getByTestId("chart-ok").click();
  await page.waitForTimeout(300);
  c = JSON.parse((await nodes("wordChart"))[0].chart);
  assert.equal(c.chartType, "bar");
  assert.equal(c.title, "Visitors");
  assert.ok((await page.locator(".ProseMirror .word-chart svg rect").count()) >= 6, "bars drawn");
  // resize from the corner
  await page.locator(".ProseMirror .word-chart").click();
  const b = await page.locator(".ProseMirror .word-chart").boundingBox();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2);
  await page.locator(".ProseMirror .word-chart .word-graphic-resize").waitFor({ state: "visible" });
  const h = await page.locator(".ProseMirror .word-chart .word-graphic-resize").boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x - 76, h.y - 36, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  charts = await nodes("wordChart");
  assert.ok(charts[0].width < 480 && charts[0].height < 288, `resized: ${charts[0].width}×${charts[0].height}`);
  log("chart edited and resized");

  // ---- SmartArt ----
  await page.evaluate(() => window.__docsEditor.chain().focus("end").run());
  await menu("Insert", "SmartArt…");
  await page.locator("[data-diagram=cycle]").click();
  await page.getByLabel("SmartArt text").fill("Plan\nDo\nCheck\nAct");
  await page.waitForFunction(() => (document.querySelector("[data-testid=smartart-preview] svg")?.textContent || "").includes("Check"));
  await page.getByTestId("smartart-ok").click();
  await page.waitForSelector(".ProseMirror .word-smartart svg");
  assert.equal(await page.locator(".ProseMirror .word-smartart svg ellipse").count(), 4);
  assert.match(await page.locator(".ProseMirror .word-smartart svg").textContent(), /PlanDoCheckAct/);
  await page.locator(".ProseMirror .word-smartart").dblclick();
  await page.locator("[data-diagram=hierarchy]").click();
  await page.getByLabel("SmartArt text").fill("Board\n  Sales\n  Support");
  await page.getByTestId("smartart-ok").click();
  await page.waitForTimeout(300);
  const d = JSON.parse((await nodes("smartArt"))[0].diagram);
  assert.equal(d.kind, "hierarchy");
  assert.deepEqual(d.items, [{ text: "Board", level: 0 }, { text: "Sales", level: 1 }, { text: "Support", level: 1 }]);
  log("SmartArt inserted and edited");

  // ---- .docx: parts written, and read back ----
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.ok(zip.file("word/charts/chart1.xml") && zip.file("word/diagrams/data1.xml") && zip.file("word/diagrams/drawing1.xml"));
  assert.match(await zip.file("word/charts/chart1.xml").async("string"), /<c:barChart>/);
  await page.evaluate((b) => window.__docsOpenBytes(b), bytes);
  await page.waitForTimeout(800);
  const c2 = JSON.parse((await nodes("wordChart"))[0].chart);
  assert.deepEqual(c2.series.map((s) => s.values), [[5, 8, 6], [2, 3, 4]]);
  assert.equal(c2.title, "Visitors");
  assert.deepEqual(JSON.parse((await nodes("smartArt"))[0].diagram).items.map((i) => i.text), ["Board", "Sales", "Support"]);
  await page.waitForSelector(".ProseMirror .word-chart svg");
  log(".docx round trip");
  console.log("docs-graphics e2e: OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-graphics-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
