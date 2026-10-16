// Browser check for page design: watermark, page colour, page borders, line
// numbers, hyphenation and mirror margins, drawn on the pages and saved.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-page-design.e2e.mjs
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
const closed = (testid) => page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"]`), testid);
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
  await page.evaluate((t) => window.__docsEditor.commands.setContent({ type: "doc", content: Array.from({ length: 30 }, () => ({ type: "paragraph", content: [{ type: "text", text: t }] })) }), para);
  await page.waitForFunction(() => window.__docsLayout?.()?.pages.length >= 2);

  // watermark on every page
  await menu("Design", "Watermark…");
  await page.getByLabel("Watermark text").fill("CONFIDENTIAL");
  await page.getByTestId("watermark-ok").click();
  await closed("watermark-ok");
  await page.waitForFunction(() => {
    const w = [...document.querySelectorAll('[data-testid="watermark"]')];
    return w.length >= 2 && w.every((e) => e.textContent === "CONFIDENTIAL");
  });
  const rot = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="watermark"] span')).transform);
  assert.notEqual(rot, "none");
  log("text watermark on each page");

  // page colour
  await menu("Design", "Page color", "#fff2cc");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".pl-page")).backgroundColor === "rgb(255, 242, 204)");
  log("page colour");

  // page borders
  await menu("Design", "Page borders…");
  await page.getByLabel("Page border style").selectOption("double");
  await page.getByTestId("page-borders-ok").click();
  await closed("page-borders-ok");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="page-border"]').length >= 2);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="page-border"]')).borderTopStyle), "double");
  log("page borders");

  // line numbers restart on each page
  await menu("Layout", "Line numbers", "Restart each page");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="line-numbers"] span').length > 20);
  const nums = await page.evaluate(() => [...document.querySelectorAll('[data-testid="line-numbers"] span')].map((s) => Number(s.textContent)));
  assert.equal(nums[0], 1);
  assert.ok(nums.filter((n) => n === 1).length >= 2, "restarts on page 2");
  log(`line numbers (${nums.length} lines)`);

  // hyphenation and mirror margins
  await menu("Layout", "Hyphenation", "Automatic");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ProseMirror p")).hyphens === "auto");
  await menu("Layout", "Mirror margins");
  log("hyphenation and mirror margins");

  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const main = await zip.file("word/document.xml").async("string");
  const settings = await zip.file("word/settings.xml").async("string");
  const header = await zip.file("word/header1.xml").async("string");
  for (const re of [/<w:background w:color="FFF2CC"\/>/, /<w:pgBorders w:offsetFrom="page"><w:top w:val="double"/, /<w:lnNumType w:countBy="1" w:restart="newPage"\/>/]) assert.match(main, re);
  for (const re of [/<w:mirrorMargins\/>/, /<w:autoHyphenation\/>/, /<w:displayBackgroundShape\/>/]) assert.match(settings, re);
  assert.match(header, /string="CONFIDENTIAL"/);
  log("saved in the .docx");
  console.log("docs page design e2e: all checks passed");
} finally {
  await browser.close();
}
