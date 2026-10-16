// Browser check for the View tools: the ruler following the page when panes
// open, dragging indents, margins and tab stops on it, formatting marks, the
// Navigation pane's search, and Read and Focus modes.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-view.e2e.mjs
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
const attrs = (i) => page.evaluate((i) => window.__docsEditor.getJSON().content[i].attrs, i);
const rulerGap = () =>
  page.evaluate(() => {
    const r = document.querySelector("[data-testid=ruler-page]").getBoundingClientRect();
    const p = document.querySelector(".pl-page").getBoundingClientRect();
    return { gap: Math.abs(r.left - p.left), width: Math.abs(r.width - p.width), left: p.left };
  });
const box = async (sel) => (await page.locator(sel).first().boundingBox());
const drag = async (sel, dx, dy = 0) => {
  const b = await box(sel);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
};
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "View" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Apples" }] },
        { type: "paragraph", content: [{ type: "text", text: "An apple a day.\tTabbed apple text." }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Pears" }] },
        { type: "paragraph", content: [{ type: "text", text: "Pears are not apples, but APPLE pie is nice." }] },
      ],
    }),
  );
  await page.waitForTimeout(500);

  // ---- the ruler sits over the page, and follows it when panes open and close ----
  let g = await rulerGap();
  assert.ok(g.gap < 2 && g.width < 2, `ruler over the page: ${JSON.stringify(g)}`);
  await menu("View", "Styles pane");
  await page.waitForTimeout(400);
  const g2 = await rulerGap();
  assert.ok(Math.abs(g2.left - g.left) > 20, "the page moved when the pane opened");
  assert.ok(g2.gap < 2, `ruler follows the page with a right pane open: ${JSON.stringify(g2)}`);
  await menu("View", "Styles pane");
  await menu("View", "Navigation pane");
  await page.waitForTimeout(400);
  g = await rulerGap();
  assert.ok(g.gap < 2, `ruler follows the page with the navigation pane toggled: ${JSON.stringify(g)}`);
  log("ruler follows the page");

  // ---- indents: drag the first-line marker half an inch right ----
  await page.evaluate(() => window.__docsEditor.commands.setTextSelection(30));
  await page.waitForTimeout(200);
  const scale = await page.evaluate(() => {
    const r = document.querySelector("[data-testid=ruler-page]").getBoundingClientRect();
    return r.width / 612;
  });
  await drag("[data-handle=first]", 36 * scale);
  await page.waitForTimeout(200);
  let a = await attrs(1);
  assert.equal(a.indFirst, 36, `first-line indent ${JSON.stringify(a)}`);
  // hanging marker: left indent moves, the first line stays where it was
  await drag("[data-handle=hanging]", 18 * scale);
  await page.waitForTimeout(200);
  a = await attrs(1);
  assert.deepEqual([a.indLeft, a.indFirst], [18, 18]);
  // right indent
  await drag("[data-handle=right]", -36 * scale);
  await page.waitForTimeout(200);
  assert.equal((await attrs(1)).indRight, 36);
  const pad = await page.evaluate(() => getComputedStyle(document.querySelectorAll(".ProseMirror > p")[0]).paddingLeft);
  assert.equal(pad, "24px");
  log("indents dragged on the ruler");

  // ---- tab stops: pick a centre tab, click to add, drag off to remove ----
  await page.getByTestId("tab-kind").click();
  assert.equal(await page.getByTestId("tab-kind").getAttribute("data-kind"), "center");
  const t = await box("[data-testid=ruler-text]");
  const textLeft = t.x;
  await page.mouse.click(textLeft + 144 * scale, t.y + t.height / 2);
  await page.waitForTimeout(200);
  a = await attrs(1);
  assert.deepEqual(a.tabs, [{ pos: 144, align: "center" }]);
  await drag("[data-tab='144']", 0, 60);
  await page.waitForTimeout(200);
  a = await attrs(1);
  assert.ok(!a.tabs || a.tabs.length === 0, `tab removed: ${JSON.stringify(a.tabs)}`);
  log("tab stops added and removed");

  // ---- margins: drag the left margin edge in by half an inch ----
  const before = await page.evaluate(() => window.__docsState().body.margins.left);
  await drag("[data-handle=marginLeft]", 36 * scale);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__docsState().body.margins.left);
  assert.equal(after, before + 36);
  log("margin dragged", before, "→", after);

  // ---- formatting marks ----
  await menu("View", "Formatting marks");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".ProseMirror .fm-para").count(), 4);
  assert.ok((await page.locator(".ProseMirror .fm-space").count()) > 10);
  assert.equal(await page.locator(".ProseMirror .fm-tab").count(), 1);
  assert.ok(!(await page.evaluate(() => window.__docsEditor.getText())).includes("¶"), "marks are not text");
  await page.keyboard.press("Control+Shift+8");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".ProseMirror .fm-para").count(), 0);
  log("formatting marks toggle");

  // ---- navigation pane search ----
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(200);
  assert.ok(await page.getByTestId("nav-search").evaluate((e) => e === document.activeElement), "Ctrl+F focuses the search box");
  await page.keyboard.type("apple");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-nav-result]").count(), 5);
  assert.equal(await page.locator(".ProseMirror .nav-hit").count(), 5);
  await page.getByLabel("Whole words").check();
  await page.waitForTimeout(200);
  assert.equal(await page.locator("[data-nav-result]").count(), 3);
  await page.getByLabel("Match case").check();
  await page.waitForTimeout(200);
  assert.equal(await page.locator("[data-nav-result]").count(), 2);
  const r2 = page.locator("[data-nav-result='1']");
  assert.match(await r2.innerText(), /^Apples/);
  assert.match(await r2.innerText(), /Tabbed apple text/);
  await r2.click();
  await page.waitForTimeout(200);
  const sel = await page.evaluate(() => {
    const { from, to } = window.__docsEditor.state.selection;
    return window.__docsEditor.state.doc.textBetween(from, to);
  });
  assert.equal(sel, "apple");
  assert.equal(await page.locator(".ProseMirror .nav-hit-current").count(), 1);
  assert.match(await page.getByTestId("nav-count").innerText(), /2 of 2/);
  await page.getByTestId("nav-search").fill("");
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".ProseMirror .nav-hit").count(), 0);
  log("navigation pane search");

  // ---- read mode: not editable, no chrome, sepia ----
  await menu("View", "Read mode");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-view-mode=read]").count(), 1);
  assert.ok(!(await page.locator("header").first().isVisible()), "menus hidden");
  assert.equal(await page.locator(".ProseMirror").getAttribute("contenteditable"), "false");
  assert.equal(await page.locator(".word-doc.web-layout").count(), 1);
  await page.getByLabel("Page color").selectOption("sepia");
  assert.equal(await page.locator(".read-mode.read-sepia").count(), 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-view-mode=normal]").count(), 1);
  assert.equal(await page.locator(".ProseMirror").getAttribute("contenteditable"), "true");
  assert.equal(await page.locator(".word-doc.print-layout").count(), 1);
  log("read mode");

  // ---- focus mode: only the document, still editable ----
  await menu("View", "Focus");
  await page.waitForTimeout(300);
  assert.ok(!(await page.locator("header").first().isVisible()));
  assert.equal(await page.getByTestId("navigation-pane").count(), 0);
  assert.equal(await page.locator(".ProseMirror").getAttribute("contenteditable"), "true");
  await page.getByTestId("exit-mode").click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator("header").first().isVisible());
  log("focus mode");
  console.log("docs-view e2e: OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-view-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
