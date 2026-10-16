// Browser check for Review > Compare: a revised .docx compared with the open
// document shows the differences as tracked changes, which save as w:ins and
// w:del and can be accepted to give the revised text.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-compare.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
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
const paras = () => page.evaluate(() => window.__docsEditor.getJSON().content.map((n) => (n.content || []).map((c) => c.text || "").join("")));
try {
  const r = await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } });
  const { id } = await r.json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  const revised = "<h1>Agreement</h1><p>The tenant pays rent monthly by bank transfer.</p><p>A new clause about pets.</p><p>Signed by both parties.</p>";
  const original = "<h1>Agreement</h1><p>The tenant pays rent weekly in cash.</p><p>An old clause that was removed.</p><p>Signed by both parties.</p>";
  await page.evaluate((h) => window.__docsEditor.commands.setContent(h), revised);
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  await page.evaluate((h) => window.__docsEditor.commands.setContent(h), original);

  await page.getByText("Review", { exact: true }).first().click();
  await page.getByText("Compare with a revised version (.docx)…", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("compare-input").setInputFiles({ name: "Revised draft.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(bytes) });
  await page.getByTestId("changes-pane").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="change-item"]').length >= 4);
  const kinds = await page.locator('[data-testid="change-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  assert.ok(kinds.includes("insertion") && kinds.includes("deletion"), kinds.join());
  assert.match(await page.locator('[data-testid="changes-pane"]').innerText(), /Revised draft/);
  const struck = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror del")].map((e) => e.textContent).join("|"));
  assert.match(struck, /weekly/);
  assert.match(struck, /An old clause that was removed\./);
  log("differences show as tracked changes:", kinds.length);

  // they save as w:ins / w:del
  const out = await page.evaluate(() => window.__docsExportBytes());
  const xml = await (await JSZip.loadAsync(Buffer.from(out))).file("word/document.xml").async("string");
  assert.match(xml, /<w:ins [^>]*w:author="Revised draft"/);
  assert.match(xml, /<w:delText[^>]*>weekly<\/w:delText>/);
  log("saved as w:ins and w:del");

  await page.getByTestId("accept-all").click();
  await page.waitForFunction(() => !document.querySelector(".ProseMirror del, .ProseMirror ins"));
  assert.deepEqual(await paras(), ["Agreement", "The tenant pays rent monthly by bank transfer.", "A new clause about pets.", "Signed by both parties."]);
  log("accept all gives the revised text");
  console.log("docs compare e2e: all checks passed");
} finally {
  await browser.close();
}
