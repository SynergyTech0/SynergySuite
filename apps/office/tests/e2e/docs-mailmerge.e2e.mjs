// Browser check for mail merge: a Sheet as the recipient list, its fields
// inserted into a letter, results previewed, and the letter merged into a new
// document (one page per recipient) and a .docx download.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-mailmerge.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const fieldsShown = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror .word-merge")].map((e) => e.textContent));
try {
  // a Sheet with three recipients
  const sheetTitle = `Recipients ${Date.now()}`;
  const s = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "sheet", title: sheetTitle } })).json();
  const snapshot = {
    id: s.id, name: sheetTitle, appVersion: "", locale: "enUS", sheetOrder: ["s1"], styles: {},
    sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 20, columnCount: 5, cellData: {
      0: { 0: { v: "First name" }, 1: { v: "City" } },
      1: { 0: { v: "Ada" }, 1: { v: "London" } },
      2: { 0: { v: "Grace" }, 1: { v: "Arlington" } },
      3: { 0: { v: "Alan" }, 1: { v: "Wilmslow" } },
    } } },
  };
  const put = await page.request.patch(`${BASE}/api/docs/${s.id}`, { data: { snapshot } });
  assert.ok(put.ok(), `snapshot saved (${put.status()})`);

  const d = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Letter" } })).json();
  await page.goto(`${BASE}/doc/${d.id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() => window.__docsEditor.chain().focus().setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Dear " }] }, { type: "paragraph", content: [{ type: "text", text: "We will visit " }] }] }).run());

  await page.getByText("Mailings", { exact: true }).first().click();
  await page.getByText("Mail merge from a Sheet…", { exact: true }).click();
  await page.getByTestId("merge-pane").waitFor();
  await page.waitForFunction((t) => [...document.querySelectorAll('[data-testid="merge-sheet"] option')].some((o) => o.textContent === t), sheetTitle);
  await page.getByTestId("merge-sheet").selectOption({ label: sheetTitle });
  await page.waitForFunction(() => /3 recipients/.test(document.querySelector('[data-testid="merge-count"]')?.textContent || ""));
  log("Sheet read: 3 recipients");

  // insert «First name» after "Dear " and «City» after "visit "
  const endOf = (text) =>
    page.evaluate((t) => {
      const ed = window.__docsEditor;
      let at = -1;
      ed.state.doc.descendants((n, pos) => {
        if (at < 0 && n.isTextblock && n.textContent.startsWith(t)) at = pos + n.nodeSize - 1;
        return at < 0;
      });
      ed.chain().focus().setTextSelection(at).run();
    }, text);
  await endOf("Dear");
  await page.getByTestId("merge-field-btn").filter({ hasText: "First name" }).click();
  await endOf("We will visit");
  await page.getByTestId("merge-field-btn").filter({ hasText: "City" }).click();
  assert.deepEqual(await fieldsShown(), ["«First name»", "«City»"]);
  log("fields inserted");

  await page.getByTestId("merge-preview").check();
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-merge")].map((e) => e.textContent).join() === "Ada,London");
  await page.getByTestId("merge-next").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-merge")].map((e) => e.textContent).join() === "Grace,Arlington");
  assert.equal(await page.getByTestId("merge-at").innerText(), "Recipient 2 of 3");
  await page.getByTestId("merge-preview").uncheck();
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-merge")].map((e) => e.textContent).join() === "«First name»,«City»");
  log("preview shows each recipient");

  // saved with the document: MERGEFIELD in the .docx
  const own = await page.evaluate(() => window.__docsExportBytes());
  assert.match(await (await JSZip.loadAsync(Buffer.from(own))).file("word/document.xml").async("string"), /MERGEFIELD &quot;First name&quot;/);

  // download
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("merge-download").click()]);
  assert.match(dl.suggestedFilename(), /\(merged\)\.docx$/);
  const xml = await (await JSZip.loadAsync(readFileSync(await dl.path()))).file("word/document.xml").async("string");
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
  assert.match(text, /Dear Ada.*We will visit London.*Dear Grace.*We will visit Arlington.*Dear Alan.*We will visit Wilmslow/);
  assert.equal((xml.match(/<w:br w:type="page"\/>|<w:pageBreakBefore\/>/g) || []).length >= 2, true, "page breaks between letters");
  log("merged .docx: three letters");

  // new document
  await page.getByTestId("merge-new").click();
  await page.waitForURL((u) => u.pathname.startsWith("/doc/") && !u.pathname.endsWith(d.id), { timeout: 60000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.waitForFunction(() => /Dear Alan/.test(window.__docsEditor?.state.doc.textContent || ""), null, { timeout: 60000 });
  const merged = await page.evaluate(() => window.__docsEditor.getJSON().content.map((n) => n.type === "pageBreak" ? "|" : (n.content || []).map((c) => c.text || "").join("")).join("\n"));
  assert.match(merged, /Dear Ada\nWe will visit London\n\|\nDear Grace/);
  const newId = new URL(page.url()).pathname.split("/").pop();
  assert.equal((await (await page.request.get(`${BASE}/api/docs/${newId}`)).json()).document.title, "Letter (merged)");
  log("merged into a new document");
  console.log("docs mail merge e2e: all checks passed");
} finally {
  await browser.close();
}
