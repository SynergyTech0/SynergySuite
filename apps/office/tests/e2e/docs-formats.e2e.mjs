// Browser check for other formats: download a document as .odt and .rtf, then
// open each one into a fresh document (through the server's LibreOffice).
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-formats.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const newDoc = async () => {
  const d = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } })).json();
  await page.goto(`${BASE}/doc/${d.id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
};
try {
  const st = await (await page.request.get(`${BASE}/api/docs/convert`)).json();
  if (!st.available) {
    console.log("docs formats e2e: skipped (no LibreOffice on the server)");
    process.exit(0);
  }
  await newDoc();
  await page.evaluate(() => window.__docsEditor.commands.setContent("<h1>Quarterly notes</h1><p>Plain and <strong>bold</strong> words.</p><ul><li>First point</li></ul>"));
  const files = {};
  for (const [fmt, label] of [["odt", "Download as OpenDocument (.odt)"], ["rtf", "Download as Rich Text (.rtf)"]]) {
    await page.getByText("File", { exact: true }).first().click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180000 }), page.getByText(label, { exact: true }).click()]);
    assert.match(dl.suggestedFilename(), new RegExp(`\\.${fmt}$`));
    files[fmt] = readFileSync(await dl.path());
    if (fmt === "odt") assert.match(files[fmt].subarray(30, 90).toString("latin1"), /opendocument\.text/);
    else assert.match(files[fmt].subarray(0, 6).toString("latin1"), /^\{\\rtf/);
    log(`saved .${fmt}`, files[fmt].length, "bytes");
  }
  for (const fmt of ["odt", "rtf"]) {
    await newDoc();
    await page.getByTestId("docx-input").setInputFiles({ name: `notes.${fmt}`, mimeType: "application/octet-stream", buffer: files[fmt] });
    await page.waitForFunction(() => /Quarterly notes/.test(window.__docsEditor.state.doc.textContent), null, { timeout: 180000 });
    const json = await page.evaluate(() => JSON.stringify(window.__docsEditor.getJSON()));
    assert.match(json, /"marks":\[\{"type":"bold"\}\],"text":"bold"/, fmt);
    assert.match(json, /First point/, fmt);
    log(`opened .${fmt}`);
  }
  console.log("docs formats e2e: all checks passed");
} finally {
  await browser.close();
}
