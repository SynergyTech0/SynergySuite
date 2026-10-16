// Browser check for the index: entries marked from the dialog (one, or every
// occurrence), the index built live with page numbers, and its options.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-index.e2e.mjs
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
const select = (text) =>
  page.evaluate((t) => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t);
    });
    ed.chain().focus().setTextSelection({ from: at, to: at + t.length }).run();
  }, text);
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Index" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Kiwi grows on vines. A kiwi is small." }] },
        { type: "pageBreak" },
        { type: "paragraph", content: [{ type: "text", text: "Mango is sweet; kiwi is sour." }] },
        { type: "paragraph" },
      ],
    }),
  );
  await page.waitForTimeout(400);

  // mark one entry with a subentry and a bold page number
  await select("Mango");
  await page.keyboard.press("Alt+Shift+X");
  assert.equal(await page.getByLabel("Main entry").inputValue(), "Mango");
  await page.getByLabel("Main entry").fill("Fruit");
  await page.getByLabel("Subentry").fill("Mango");
  await page.getByText("Bold page number").click();
  await page.getByTestId("xe-mark").click();
  // mark every "kiwi"
  await select("Kiwi");
  await menu("References", "Mark entry…");
  await page.getByTestId("xe-mark-all").click();
  const entries = await page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.descendants((n) => {
      if (n.type.name === "indexEntry") out.push(n.attrs.entry);
    });
    return out;
  });
  assert.deepEqual(entries, ["Kiwi", "Kiwi", "Fruit:Mango", "Kiwi"]);
  // entries show with formatting marks (turned on by marking), hidden otherwise
  assert.ok(await page.locator(".ProseMirror .word-xe").first().isVisible());
  await page.keyboard.press("Control+Shift+8");
  assert.ok(!(await page.locator(".ProseMirror .word-xe").first().isVisible()));
  log("entries marked");

  // the index
  await page.evaluate(() => window.__docsEditor.chain().focus("end").run());
  await menu("References", "Insert index…");
  await page.getByLabel("Index columns").fill("1");
  await page.getByTestId("index-ok").click();
  await page.waitForSelector(".ProseMirror .word-index .word-index-entry");
  const rows = await page.locator(".ProseMirror .word-index .word-index-entry").allInnerTexts();
  assert.deepEqual(rows.map((r) => r.replace(/\s+/g, " ").trim()), ["Fruit", "Mango, 2", "Kiwi, 1, 2"]);
  assert.deepEqual(await page.locator(".ProseMirror .word-index .word-index-heading").allInnerTexts(), ["F", "K"]);
  assert.equal(await page.locator(".ProseMirror .word-index b").innerText(), "2", "bold page number");
  // live: another entry appears without a refresh
  await select("vines");
  await page.keyboard.press("Alt+Shift+X");
  await page.getByTestId("xe-mark").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".word-index-heading")].map((e) => e.textContent).join() === "F,K,V");
  // options: double-click, two columns, right-aligned numbers
  await page.locator(".ProseMirror .word-index").dblclick();
  await page.getByLabel("Index columns").fill("2");
  await page.getByText("Right align page numbers").click();
  await page.getByTestId("index-ok").click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".word-index")).columnCount === "2");
  assert.equal(await page.locator(".ProseMirror .word-index.word-index-right").count(), 1);
  log("index built, live, with options");
  console.log("docs-index e2e: OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-index-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
