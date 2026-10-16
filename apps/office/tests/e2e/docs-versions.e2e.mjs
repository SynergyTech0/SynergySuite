// Browser check for version history: a saved version carries the page setup
// and styles, and restoring it brings them back with the text.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-versions.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const state = () => page.evaluate(() => window.__docsState());
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Versions" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() => window.__docsEditor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First draft" }] }] }));

  // save a named version
  await menu("File", "Version history");
  page.once("dialog", (d) => d.accept("v1"));
  await page.getByText("Save a version now").click();
  await page.getByText("v1", { exact: true }).waitFor();
  const { versions } = await (await page.request.get(`${BASE}/api/docs/${id}/versions`)).json();
  const v1 = versions.find((v) => v.label === "v1");
  const { version } = await (await page.request.get(`${BASE}/api/docs/${id}/versions/${v1.id}`)).json();
  const saved = JSON.parse(version.state);
  assert.equal(saved.doc.content[0].content[0].text, "First draft");
  log("version saved with its state");

  // change the text and the page setup
  await page.evaluate(() => window.__docsEditor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Second draft" }] }] }));
  await menu("Layout", "Orientation: Landscape");
  await page.waitForFunction(() => window.__docsState().body.orientation === "landscape");

  // restore v1: text and portrait page come back
  await page.getByText("v1", { exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByText("Restore this version").click();
  await page.waitForFunction(() => window.__docsState().body.orientation === "portrait");
  assert.equal(await page.evaluate(() => window.__docsEditor.getText()), "First draft");
  const s = await state();
  assert.ok(s.body.pageWidth < s.body.pageHeight);
  // the version saved before the restore keeps the landscape page
  const after = (await (await page.request.get(`${BASE}/api/docs/${id}/versions`)).json()).versions;
  const before = after.find((v) => v.label === "before restore");
  const bv = (await (await page.request.get(`${BASE}/api/docs/${id}/versions/${before.id}`)).json()).version;
  assert.equal(JSON.parse(JSON.parse(bv.state).body).orientation, "landscape");
  log("restored text and page setup");
  console.log("docs-versions e2e: OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-versions-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
