// Browser check for Docs milestone 2 proofing: misspellings and grammar
// issues are underlined as you type, fixed from the right-click menu and the
// Spelling and grammar pane (F7), words can be added to the dictionary, and
// checking can be switched off.
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-proofing.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const OUT = mkdtempSync(path.join(tmpdir(), "docs-e2e5-"));
const log = (...a) => console.log("•", ...a);

async function newDoc(page) {
  const r = await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } });
  const { id } = await r.json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__docsLayout === "function" && window.__docsLayout() !== null, null, { timeout: 60000 });
  return id;
}
const layout = (page) => page.evaluate(() => window.__docsLayout());
async function waitLayout(page, test, what) {
  await page.waitForFunction((t) => {
    const l = window.__docsLayout();
    return !!l && new Function("l", `return ${t}`)(l);
  }, test, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`${what}: ${JSON.stringify(await layout(page))} (${e.message})`);
  });
}
const settle = (page) => page.waitForTimeout(400);


const menu = async (page, top, item) => {
  await page.getByText(top, { exact: true }).first().click();
  await page.getByText(item, { exact: true }).first().click();
};
const textOf = (page, sel) => page.locator(sel).allInnerTexts().then((a) => a.map((t) => t.replace(/\s+/g, " ").trim()));
/** Click a dialog's button, then wait until the dialog is gone and the editor has the focus again. */
const confirm = async (page, testid) => {
  await page.locator(`[data-testid="${testid}"]`).click();
  await page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"]`) && document.activeElement?.classList.contains("ProseMirror"), testid);
};
const clickEnd = async (page, text) => {
  await page.evaluate((t) => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isTextblock && n.textContent.includes(t)) at = pos + n.nodeSize - 1;
      return at < 0;
    });
    ed.chain().focus().setTextSelection(at).run();
  }, text);
  // Tiptap moves the focus in an animation frame
  await page.waitForFunction(() => document.activeElement?.classList.contains("ProseMirror"));
  await page.waitForTimeout(50);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
const marked = (cls) => page.evaluate((c) => [...document.querySelectorAll(`.ProseMirror .${c}`)].map((e) => e.textContent), cls);
const docText = () => page.evaluate(() => window.__docsEditor.state.doc.textContent);
try {
  await newDoc(page);
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(1).run());
  await page.waitForFunction(() => document.activeElement?.classList.contains("ProseMirror"));
  await page.keyboard.type("This is teh first sentence. it has a error and the the repeated word.");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .sp-err")].some((e) => e.textContent === "teh"), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .gr-err").length >= 3);
  assert.deepEqual(await marked("sp-err"), ["teh"]);
  assert.deepEqual(await marked("gr-err"), ["it", "a", "the the"]);
  log("as you type: “teh” underlined red; “it”, “a” and “the the” underlined blue");

  // right-click: suggestions
  await page.locator(".ProseMirror .sp-err").first().click({ button: "right" });
  await page.waitForSelector('[data-testid="proof-menu"]');
  await page.locator('[data-testid="proof-suggestion"]', { hasText: /^the$/ }).first().click();
  await page.waitForFunction(() => window.__docsEditor.state.doc.textContent.startsWith("This is the first sentence."));
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .sp-err").length === 0);
  log("right-click > “the” fixed the misspelling");

  // the pane (F7) fixes the grammar
  await page.keyboard.press("F7");
  await page.waitForSelector('[data-testid="proof-pane"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="proof-item"][data-kind="grammar"]').length === 3);
  assert.equal(await page.locator('[data-testid="proof-summary"]').innerText(), "0 spelling, 3 grammar");
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-testid="proof-item"] [data-testid="proof-fix"]').first().click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="proof-item"]').length === n, 2 - i, { timeout: 10000 });
  }
  assert.equal(await docText(), "This is the first sentence. It has an error and the repeated word.");
  assert.equal(await page.locator('[data-testid="proof-summary"]').innerText(), "No spelling or grammar issues found.");
  log("Spelling and grammar pane: three grammar fixes (capital, a/an, repeated word)");

  // add a word to the dictionary
  await page.keyboard.press("End");
  await page.keyboard.type(" Made by Synergix.");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .sp-err")].some((e) => e.textContent === "Synergix"), null, { timeout: 20000 });
  await page.locator(".ProseMirror .sp-err").first().click({ button: "right" });
  await page.locator('[data-testid="proof-add"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .sp-err").length === 0);
  log("“Synergix” added to the dictionary");

  // switch checking off
  await page.keyboard.press("End");
  await page.keyboard.type(" Anothr mistake.");
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .sp-err").length === 1, null, { timeout: 20000 });
  await page.getByText("Review", { exact: true }).first().click();
  await page.getByText("Check spelling as you type", { exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .sp-err, .ProseMirror .gr-err").length === 0);
  await page.screenshot({ path: path.join(OUT, "1-proofing.png") });
  log("checking switched off: no underlines");
  await page.evaluate(() => localStorage.removeItem("syn-docs-proofing"));
  console.log(`PASS — screenshots in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error("document:", await docText().catch(() => "?"), "| spelling:", await marked("sp-err").catch(() => "?"), "| grammar:", await marked("gr-err").catch(() => "?"));
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
