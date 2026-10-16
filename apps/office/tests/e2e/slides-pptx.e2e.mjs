// Browser check for Slides + .pptx: import a deck, edit it, export it,
// re-import the export and compare; then run the slide show / presenter view.
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/slides-pptx.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary when Playwright's own is missing.)
// (NODE_PATH may point at a global Playwright install.) Uses python-pptx to
// write the input deck when available, else a deck written by PptxGenJS.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const OUT = mkdtempSync(path.join(tmpdir(), "slides-e2e-"));
const here = path.dirname(new URL(import.meta.url).pathname);

function inputDeck() {
  const file = path.join(OUT, "input.pptx");
  try {
    execFileSync("python3", [path.join(here, "..", "fixtures", "make_python_pptx.py"), file]);
    return { file, kind: "python-pptx" };
  } catch {
    throw new Error("python-pptx is required for the e2e input deck (pip install python-pptx)");
  }
}

const log = (...a) => console.log("•", ...a);

/** What the Next.js dev overlay reports (its issues badge and dialog), or "" when it has nothing. */
async function devIssues(page) {
  return page.evaluate(async () => {
    const root = document.querySelector("nextjs-portal")?.shadowRoot;
    if (!root) return "";
    const textOf = () => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const out = [];
      for (let n; (n = w.nextNode()); ) if (n.parentElement && !["STYLE", "SCRIPT"].includes(n.parentElement.tagName) && n.textContent.trim()) out.push(n.textContent.trim());
      return out.join(" | ");
    };
    if (!/\d+\s*\|?\s*Issues?\b/.test(textOf())) return "";
    const badge = [...root.querySelectorAll("button")].find((b) => /Issue/.test(b.textContent || "") || b.hasAttribute("data-issues-open"));
    badge?.click();
    await new Promise((r) => setTimeout(r, 800));
    return textOf().slice(0, 4000);
  });
}

// dev overlay issues seen on each page before it is left
const issuesSeen = [];
async function openNewDeck(page) {
  if (page.url().includes("/slides/")) {
    const i = await devIssues(page);
    if (i) issuesSeen.push(`${page.url()}: ${i}`);
  }
  await page.goto(`${BASE}/slides`);
  await page.waitForSelector('[data-testid="slide-canvas"]', { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__slides === "function" && window.__slides().length > 0);
}

async function importInto(page, file) {
  // a non-empty deck asks before its slides are replaced; drop the handler when no one asked
  const accept = (d) => d.accept();
  page.once("dialog", accept);
  await page.setInputFiles('[data-testid="pptx-input"]', file);
  await page.waitForSelector('[data-testid="import-notice"]', { timeout: 60000 });
  page.off("dialog", accept);
}

const summary = (slides) =>
  slides.map((s) => ({
    title: s.title,
    layout: s.layout,
    bodyText: s.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    notes: s.notes,
    els: s.elements.map((e) => `${e.type}${e.type === "shape" ? ":" + e.shape : ""}`).sort(),
  }));

// CHROMIUM_PATH runs a Chromium build that differs from the one Playwright expects.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
try {
  const { file, kind } = inputDeck();
  log(`input deck written with ${kind}`);

  // 1) import from the documents list ("+ New" > "Open presentation file…")
  // the file input only works once the list has hydrated: retry until it navigates
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  for (let i = 0; ; i++) {
    await page.setInputFiles('[data-testid="doclist-pptx"]', file);
    try {
      await page.waitForURL(/\/slides\//, { timeout: 15000 });
      break;
    } catch (e) {
      if (i === 5) throw e;
    }
  }
  await page.waitForSelector('[data-testid="import-notice"]', { timeout: 120000 });
  await page.waitForFunction(() => window.__slides().length === 3);
  const imported = await page.evaluate(() => window.__slides());
  assert.equal(imported[0].title, "Quarterly Review");
  assert.equal(imported[1].title, "Highlights");
  assert.match(imported[1].body, /Revenue up/);
  assert.equal(imported[1].notes, "Mention the hiring plan");
  assert.ok(imported[2].elements.some((e) => e.type === "image"));
  assert.ok(imported[2].elements.some((e) => e.type === "table"));
  const meta = await page.evaluate(() => window.__deckMeta());
  assert.deepEqual([meta.w, meta.h], [960, 720]);
  assert.equal(await page.locator('[data-testid="slide-thumb"]').count(), 3);
  await page.screenshot({ path: path.join(OUT, "1-imported.png") });
  log("imported 3 slides (title, bullets, notes, picture, table, shape)");

  // 2) edit: title, body, a new text box, a shape, notes; reorder slides
  await page.locator('[data-testid="slide-thumb"]').nth(1).click();
  await page.locator('[data-testid="slide-title"]').fill("Highlights (edited)");
  // wait for the body editor to own the focus before typing: a click that lands
  // while the slide is still switching only selects the placeholder frame
  await page.locator('[data-testid="slide-body"] li, [data-testid="slide-body"] p').last().click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "slide-body");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Added in the browser");
  await page.locator('[data-testid="tb-textbox"]').click();
  await page.waitForSelector('[data-testid="el-editor"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "el-editor");
  await page.keyboard.type("A new text box");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-star5"]').click();
  await page.locator('[data-testid="slide-notes"]').fill("Edited notes");
  // drag the star by 100 screen px
  const star = page.locator('[data-testid="el-shape"][data-selected="1"]');
  const bb = await star.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 100, bb.y + bb.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  // move slide 3 to the front by drag and drop in the rail
  await page.locator('[data-testid="slide-thumb"]').nth(2).dragTo(page.locator('[data-testid="slide-thumb"]').nth(0));
  await page.waitForFunction(() => window.__slides()[0].layout === "blank");
  // transition + entrance animation on the edited slide via the Animations pane
  const starId = await page.evaluate(() => window.__slides().find((s) => s.title === "Highlights (edited)").elements.find((e) => e.shape === "star5").id);
  await page.locator('[data-testid="slide-thumb"]').nth(2).click();
  await page.locator(`[data-el-id="${starId}"]`).click();
  await page.locator('[data-testid="tb-anim"]').click();
  await page.waitForSelector('[data-testid="anim-panel"]');
  await page.locator('[data-testid="trans-type"]').selectOption("push");
  await page.locator('[data-testid="anim-effect"]').selectOption("fly");
  await page.waitForFunction(() => window.__slides().some((s) => s.trans?.type === "push" && s.elements.some((e) => e.anim?.effect === "fly")));
  assert.equal(await page.locator('[data-testid="anim-row"]').count(), 1);
  log("set a push transition and a fly-in animation in the Animations pane");

  // multi-select (Shift+click), align top, group, rotate with the handle
  const tbId = await page.evaluate(() => window.__slides().find((s) => s.title === "Highlights (edited)").elements.find((e) => e.type === "text").id);
  await page.keyboard.press("Escape");
  await page.locator(`[data-el-id="${starId}"]`).click();
  await page.locator(`[data-el-id="${tbId}"]`).click({ modifiers: ["Shift"] });
  await page.waitForSelector('[data-testid="group-bounds"]');
  await page.locator('[data-testid="multi-selection-bar"] [data-testid="align-top"]').click();
  await page.keyboard.press("Control+g");
  await page.waitForFunction(([a, b]) => {
    const els = window.__slides().find((s) => s.title === "Highlights (edited)").elements;
    const x = els.find((e) => e.id === a), y = els.find((e) => e.id === b);
    return x.group && x.group === y.group && Math.abs(x.y - y.y) < 0.5;
  }, [starId, tbId]);
  // clicking one member selects the whole group
  await page.keyboard.press("Escape");
  await page.locator(`[data-el-id="${starId}"]`).click();
  assert.equal(await page.locator('[data-selected="1"][data-el-id]').count(), 2);
  // ungroup, then rotate the star alone with Shift (15° steps)
  await page.keyboard.press("Control+Shift+g");
  await page.keyboard.press("Escape");
  await page.locator(`[data-el-id="${starId}"]`).click();
  const handle = page.locator(`[data-el-id="${starId}"] [data-handle="rot"]`);
  const sb = await page.locator(`[data-el-id="${starId}"]`).boundingBox();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(sb.x + sb.width + 80, sb.y + sb.height / 2 + 4, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForFunction((id) => window.__slides().find((s) => s.title === "Highlights (edited)").elements.find((e) => e.id === id).rot === 90, starId);
  // marquee from the grey stage around both objects, then regroup for the round trip
  await page.keyboard.press("Escape");
  const canvas = await page.locator('[data-testid="slide-canvas"]').boundingBox();
  const tbb = await page.locator(`[data-el-id="${tbId}"]`).boundingBox();
  const stb = await page.locator(`[data-el-id="${starId}"]`).boundingBox();
  // start on the slide below and right of the content placeholder, sweep up across both objects
  await page.mouse.move(canvas.x + canvas.width - 6, canvas.y + canvas.height - 6);
  await page.mouse.down();
  await page.mouse.move(Math.min(tbb.x, stb.x) + 5, Math.min(tbb.y, stb.y) + 5, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator('[data-selected="1"][data-el-id]').count(), 2, "marquee selects both objects");
  await page.keyboard.press("Control+g");
  await page.waitForFunction((id) => !!window.__slides().find((s) => s.title === "Highlights (edited)").elements.find((e) => e.id === id).group, starId);
  // dragging one member moves the group
  const pos = () => page.evaluate(([a, b]) => { const els = window.__slides().find((s) => s.title === "Highlights (edited)").elements; return [a, b].map((id) => els.find((e) => e.id === id)).map((e) => [e.x, e.y]); }, [starId, tbId]);
  const before = await pos();
  const sb2 = await page.locator(`[data-el-id="${starId}"]`).boundingBox();
  await page.mouse.move(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb2.x + sb2.width / 2 - 37, sb2.y + sb2.height / 2 + 29, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(([a, x0]) => window.__slides().find((s) => s.title === "Highlights (edited)").elements.find((e) => e.id === a).x !== x0, [starId, before[0][0]]);
  const after = await pos();
  const d = after.map((p, i) => [p[0] - before[i][0], p[1] - before[i][1]]);
  assert.ok(Math.abs(d[0][0] - d[1][0]) < 0.2 && Math.abs(d[0][1] - d[1][1]) < 0.2 && d[0][0] < -20, `group moved together: ${JSON.stringify(d)}`);
  await page.screenshot({ path: path.join(OUT, "2b-grouped.png") });
  log("shift-click and marquee multi-select, align top, group/ungroup, rotate handle with Shift snapping");

  // chart: insert a column chart, make it stacked horizontal bars with data labels, edit its data
  await page.locator('[data-testid="tb-chart"]').click();
  await page.locator('[data-testid="chart-insert-bar"]').click();
  await page.locator('[data-testid="tb-chart-edit"]').click();
  await page.locator('[data-testid="chart-dir"]').selectOption("bar");
  await page.locator('[data-testid="chart-stacked"]').check();
  await page.locator('[data-testid="chart-labels"]').check();
  await page.locator('[data-testid="chart-data"]').fill("Category,North,South\nJan,10,4\nFeb,20,6\nMar,15,9");
  await page.locator('[data-testid="chart-apply"]').click();
  await page.waitForFunction(() => window.__slides().some((s) => s.elements.some((e) => e.type === "chart" && e.barDir === "bar" && e.stacked && e.dataLabels && e.categories.join() === "Jan,Feb,Mar")));
  // axes: bounds, unit, currency format, minor gridlines, a title; a linear trendline with its equation
  const axes = page.locator('[data-testid="chart-axes"]');
  if (!(await axes.evaluate((d) => d.open))) await axes.locator("summary").click();
  for (const [id, v] of [["chart-val-min", "0"], ["chart-val-max", "40"], ["chart-val-major", "10"]]) {
    await page.locator(`[data-testid="${id}"]`).fill(v);
    await page.locator(`[data-testid="${id}"]`).press("Enter");
  }
  await page.locator('[data-testid="chart-val-fmt"]').selectOption("$#,##0");
  await page.locator('[data-testid="chart-val-minor-grid"]').check();
  await page.locator('[data-testid="chart-val-title"]').fill("Units");
  await page.locator('[data-testid="chart-val-title"]').press("Tab");
  await page.locator('[data-testid="chart-trend-type"]').selectOption("linear");
  await page.locator('[data-testid="chart-trend-eq"]').check();
  await page.waitForFunction(() => window.__slides().some((s) => s.elements.some((e) => e.type === "chart" && e.valAx?.max === 40 && e.valAx?.major === 10 && e.valAx?.fmt === "$#,##0" && e.valAx?.minorGrid && e.valAx?.title === "Units" && e.series[0].trend?.type === "linear" && e.series[0].trend?.eq)));
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(OUT, "2c-chart.png") });
  log("inserted a chart, edited type options and data, set axis bounds/unit/format/gridlines/title and a trendline");

  // rich text: superscript, subscript, a link, highlight, line and paragraph spacing
  await page.locator('[data-testid="tb-textbox"]').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "el-editor");
  await page.keyboard.type("E=mc");
  await page.locator('[data-testid="tb-sup"]').click();
  await page.keyboard.type("2");
  await page.locator('[data-testid="tb-sup"]').click();
  await page.keyboard.type(" H");
  await page.locator('[data-testid="tb-sub"]').click();
  await page.keyboard.type("2");
  await page.locator('[data-testid="tb-sub"]').click();
  await page.keyboard.type("O see ");
  // select with the keyboard while the text keeps the focus (toolbar buttons never take it)
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.locator('[data-testid="tb-highlight"]').click();
  await page.locator('button[title="#FFC000"]').click();
  await page.keyboard.press("End");
  await page.locator('[data-testid="tb-link"]').click();
  await page.locator('[data-testid="link-url"]').fill("example.com");
  await page.locator('[data-testid="link-apply"]').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "el-editor");
  await page.locator('[data-testid="tb-spacing"]').click();
  await page.locator('[data-testid="line-1.5"]').click();
  await page.locator('[data-testid="tb-spacing"]').click();
  await page.locator('[data-testid="space-before"]').fill("6");
  await page.locator('[data-testid="space-apply"]').click();
  await page.keyboard.press("Escape");
  const richOk = (html) =>
    /<sup>2<\/sup>/.test(html) && /<sub>2<\/sub>/.test(html) && /<a [^>]*href="https:\/\/example.com"/.test(html) && /<mark[^>]*#FFC000[^>]*>E<\/mark>/i.test(html) && /line-height: 1.8/.test(html) && /margin-top: 6pt/.test(html);
  await page.waitForFunction(() => window.__slides().some((s) => s.elements.some((e) => e.type === "text" && /margin-top: 6pt/.test(e.html))));
  const richHtml = await page.evaluate(() => window.__slides().flatMap((s) => s.elements).find((e) => e.type === "text" && /=mc/.test(e.html)).html);
  assert.ok(richOk(richHtml), `rich text applied: ${richHtml}`);
  await page.screenshot({ path: path.join(OUT, "2d-rich-text.png") });
  // find (moves to the slide holding the match) and replace all
  await page.keyboard.press("Control+h");
  await page.waitForSelector('[data-testid="find-panel"]');
  await page.locator('[data-testid="find-input"]').fill("Quarterly");
  await page.locator('[data-testid="find-next"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="slide-title"]')?.textContent === "Quarterly Review");
  await page.locator('[data-testid="find-input"]').fill("in the browser");
  await page.locator('[data-testid="replace-input"]').fill("in the web browser");
  await page.locator('[data-testid="replace-all"]').click();
  await page.waitForFunction(() => /Replaced 1 /.test(document.querySelector('[data-testid="find-status"]')?.textContent || ""));
  await page.locator('[data-testid="find-input"]').press("Escape");
  await page.waitForSelector('[data-testid="find-panel"]', { state: "detached" });
  log("superscript, subscript, link, highlight, line/paragraph spacing; find and replace all");

  // slide master: a title colour and a logo shape on every slide; header & footer; theme; a section
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByText("Slide master", { exact: true }).click();
  await page.waitForSelector('[data-testid="master-panel"]');
  await page.locator('[data-testid="master-title-color"]').fill("#aa0000");
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-ellipse"]').click();
  await page.waitForFunction(() => window.__masters().master?.elements.length === 1 && window.__masters().master.tstyle?.color === "AA0000");
  await page.locator('[data-testid="master-thumb"][data-key="title"]').click();
  await page.locator('[data-testid="master-bg"]').fill("#fff7ed");
  await page.waitForFunction(() => window.__masters().title?.bg === "FFF7ED");
  // the imported deck's own layouts are custom layouts here; add one more
  assert.ok(await page.locator('[data-testid="master-thumb"][data-key^="c:"]').count() >= 1, "foreign layouts became editable layouts");
  page.once("dialog", (d) => d.accept("Section Break"));
  await page.locator('[data-testid="layout-new"]').click();
  await page.waitForFunction(() => Object.values(window.__masters()).some((m) => m?.lname === "Section Break"));
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-rect"]').click();
  await page.waitForFunction(() => Object.values(window.__masters()).find((m) => m?.lname === "Section Break")?.elements.length >= 1);
  await page.screenshot({ path: path.join(OUT, "2e-master.png") });
  await page.locator('[data-testid="master-close"]').click();
  await page.waitForSelector('[data-testid="slide-rail"]');
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByText("Header & footer…").click();
  await page.locator('[data-testid="hf-num"]').check();
  await page.locator('[data-testid="hf-footer"]').check();
  await page.locator('[data-testid="hf-footer-text"]').fill("Synergy Tech");
  await page.locator('[data-testid="hf-skip-title"]').check();
  await page.locator('[data-testid="hf-apply"]').click();
  await page.locator('[data-testid="slide-thumb"]').nth(2).click();
  await page.waitForSelector('[data-testid="slide-canvas"] [data-testid="slide-number"]');
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByText("Customize theme colours and fonts…").click();
  await page.locator('[data-testid="theme-accent"]').fill("#dc2626");
  await page.locator('[data-testid="theme-head-font"]').fill("Georgia");
  await page.locator('[data-testid="theme-apply"]').click();
  page.once("dialog", (d) => d.accept("Details"));
  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByText("Add section").click();
  await page.waitForFunction(() => window.__slides().some((s) => s.sec === "Details"));
  assert.equal(await page.locator('[data-testid="section-header"]').count(), 2);
  const look = await page.evaluate(() => window.__deckMeta());
  assert.deepEqual([look.colors?.accent, look.headFont, look.hf?.footer, look.hf?.num], ["DC2626", "Georgia", "Synergy Tech", true]);
  await page.screenshot({ path: path.join(OUT, "2f-footer-sections.png") });
  log("slide master title colour + logo, layout background, header & footer, theme colours/fonts, sections");

  // comments: on the formula text box (Ctrl+Alt+M), a reply, a pin on the slide and a badge in the rail
  const formulaId = await page.evaluate(() => window.__slides().flatMap((s) => s.elements).find((e) => e.type === "text" && /=mc/.test(e.html)).id);
  await page.keyboard.press("Escape");
  await page.locator(`[data-el-id="${formulaId}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-el-id="${id}"]`)?.getAttribute("data-selected") === "1", formulaId);
  await page.keyboard.press("Control+Alt+m");
  await page.locator('[data-testid="comment-input"]').fill("Check the formula @shane@example.com");
  await page.locator('[data-testid="comment-post"]').click();
  await page.waitForSelector('[data-testid="comment-thread"]');
  await page.locator('[data-testid="comment-reply"]').click();
  await page.locator('[data-testid="comment-reply-input"]').fill("Will do");
  await page.locator('[data-testid="comment-reply-post"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="comment-thread"] [data-testid="comment-author"]').length === 2);
  assert.equal(await page.locator('[data-testid="comment-pin"]').count(), 1);
  assert.equal(await page.locator('[data-testid="thumb-comments"]').count(), 1);
  assert.equal(await page.locator('[data-testid="comment-mention"]').count(), 1);
  await page.screenshot({ path: path.join(OUT, "2g-comments.png") });
  log("comment on an object with a reply and an @mention; pin on the slide, badge in the rail");
  // 2h) a new blank slide: gradient + shadow on a shape, a cropped picture,
  // entrance/emphasis/motion-path/exit effects, and a video that plays by itself
  await page.locator('[data-testid="slide-thumb"]').last().click();
  const fxIdx = await page.evaluate(() => window.__slides().length);
  await page.locator('[data-testid="tb-new-slide"]').click();
  await page.locator('[data-testid="new-slide-blank"]').click();
  await page.waitForFunction((n) => window.__slides().length === n + 1 && window.__slides()[n].layout === "blank", fxIdx);
  // picture: 2x2 PNG, cropped 25% from the left
  await page.setInputFiles('input[type=file][accept="image/*"]', { name: "dot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64") });
  await page.waitForFunction((i) => window.__slides()[i].elements.some((x) => x.type === "image"), fxIdx);
  await page.locator('[data-testid="tb-crop"]').click();
  await page.locator('[data-testid="crop-l"]').fill("25");
  await page.locator('[data-testid="crop-apply"]').click();
  await page.waitForFunction((i) => window.__slides()[i].elements.find((x) => x.type === "image")?.crop?.l === 0.25, fxIdx);
  assert.equal(await page.locator("[data-el-id] [data-crop]").count(), 1, "cropped picture drawn");
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-roundRect"]').click();
  await page.locator('[data-testid="tb-fill"]').click();
  await page.locator('[data-testid="grad-preset-sunset"]').click();
  await page.locator('[data-testid="tb-shadow"]').click();
  await page.locator('[data-testid="shadow-br"]').click();
  await page.waitForFunction((i) => { const e = window.__slides()[i].elements.find((x) => x.shape === "roundRect"); return e?.grad?.stops.length === 2 && e.shadow?.dir === 45; }, fxIdx);
  assert.equal(await page.locator('[data-testid="el-shape"] svg[data-grad="1"]').count(), 1, "gradient drawn on the canvas");
  const rrId = await page.evaluate((i) => window.__slides()[i].elements.find((x) => x.shape === "roundRect").id, fxIdx);
  // effects on the shape: fade in, pulse, move right, fade out
  await page.locator(`[data-el-id="${rrId}"]`).click();
  if (!(await page.locator('[data-testid="anim-panel"]').count())) await page.locator('[data-testid="tb-anim"]').click();
  await page.locator('[data-testid="anim-effect"]').selectOption("fade");
  await page.locator('[data-testid="anim-add-emph"]').click();
  await page.locator('[data-testid="anim-add-path"]').click();
  await page.locator('[data-testid="anim-path-2"]').selectOption("right");
  await page.locator('[data-testid="anim-start-2"]').selectOption("after");
  await page.locator('[data-testid="anim-add-exit"]').click();
  await page.waitForFunction(([i, id]) => { const e = window.__slides()[i].elements.find((x) => x.id === id); return e.anim?.effect === "fade" && e.fx?.map((f) => f.kind).join() === "emph,path,exit"; }, [fxIdx, rrId]);
  assert.equal(await page.locator('[data-testid="anim-effect-card"]').count(), 4);
  // a short WebM recorded in the page, inserted as a video that starts automatically and loops
  const webm = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 160; c.height = 90;
    const g = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.start(100);
    for (let k = 0; k < 12; k++) { g.fillStyle = `hsl(${k * 30} 80% 50%)`; g.fillRect(0, 0, 160, 90); await new Promise((r) => setTimeout(r, 70)); }
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const b = new Uint8Array(await new Blob(parts, { type: "video/webm" }).arrayBuffer());
    let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  });
  await page.setInputFiles('[data-testid="media-input"]', { name: "clip.webm", mimeType: "video/webm", buffer: Buffer.from(webm, "base64") });
  await page.waitForFunction((i) => window.__slides()[i].elements.some((x) => x.type === "media"), fxIdx, { timeout: 30000 });
  await page.locator('[data-testid="tb-playback"]').click();
  await page.locator('[data-testid="media-autoplay"]').check();
  await page.locator('[data-testid="media-loop"]').check();
  await page.keyboard.press("Escape");
  await page.waitForFunction((i) => { const m = window.__slides()[i].elements.find((x) => x.type === "media"); return m?.autoplay && m.loop; }, fxIdx);
  const vid = await page.evaluate((i) => window.__slides()[i].elements.find((x) => x.type === "media"), fxIdx);
  assert.match(vid.src, /^\/api\/docs\/[^/]+\/media\/[\w-]+$/);
  assert.match(vid.poster || "", /^data:image\/jpeg;base64,/, "poster grabbed from the video");
  const ranged = await page.evaluate(async (u) => { const r = await fetch(u, { headers: { Range: "bytes=0-9" } }); return [r.status, r.headers.get("content-range"), (await r.arrayBuffer()).byteLength]; }, vid.src);
  assert.equal(ranged[0], 206);
  assert.match(ranged[1], /^bytes 0-9\/\d+$/);
  assert.equal(ranged[2], 10);
  // slide show: the video plays on its own; the shape fades in, pulses, moves right and fades out
  await page.keyboard.press("Shift+F5"); // from the current slide
  await page.waitForSelector('[data-testid="slideshow"]');
  await page.waitForSelector('[data-testid="slideshow"] video[data-media="video"]');
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="slideshow"] video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 15000 });
  const shapeSel = `[data-testid="slideshow"] [data-anim="${rrId}"]`;
  assert.equal(await page.getAttribute(shapeSel, "data-anim-hidden"), "1");
  await page.keyboard.press("ArrowRight"); // fade in
  await page.waitForFunction((sel) => !document.querySelector(sel).getAttribute("data-anim-hidden"), shapeSel);
  await page.keyboard.press("ArrowRight"); // pulse, then the path after it
  await page.waitForSelector(`${shapeSel} [data-anim-play="pulse path"]`, { state: "attached" });
  await page.waitForTimeout(2700);
  await page.screenshot({ path: path.join(OUT, "2h-show-path.png") });
  await page.keyboard.press("ArrowRight"); // fade out
  await page.waitForSelector(`${shapeSel} [data-anim-play="fade"]`, { state: "attached" });
  const moved = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).transform, shapeSel);
  assert.notEqual(moved, "none", "the motion path leaves the shape moved");
  // the fade out holds its last frame: the shape is gone
  await page.waitForFunction((sel) => getComputedStyle(document.querySelector(`${sel} [data-anim-play]`)).opacity === "0", shapeSel);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  log("gradient + shadow, picture crop, fade/pulse/motion path/exit effects, autoplaying looping video in the show");

  // 2i) pen tool: a closed loop becomes a filled freeform; the slide moves to the custom layout
  await page.locator('[data-testid="tb-pen"]').click();
  const pl = await page.locator('[data-testid="pen-layer"]').boundingBox();
  const cx = pl.x + pl.width * 0.25, cy = pl.y + pl.height * 0.3, rr = pl.height * 0.12;
  await page.mouse.move(cx + rr, cy);
  await page.mouse.down();
  for (let k = 1; k <= 36; k++) await page.mouse.move(cx + rr * Math.cos((k * Math.PI) / 18), cy + rr * Math.sin((k * Math.PI) / 18));
  await page.mouse.up();
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.shape === "freeform" && /Z$/.test(e.geom?.d || "") && e.fill), fxIdx);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="pen-layer"]', { state: "detached" });
  await page.locator('[data-testid="tb-layout"]').click();
  await page.getByRole("button", { name: "Section Break" }).click();
  await page.waitForFunction((i) => { const s = window.__slides()[i]; const m = window.__masters()[`c:${s.clayout}`]; return m?.lname === "Section Break"; }, fxIdx);
  log("pen tool drew a closed freeform; slide switched to a custom layout");

  // 2j) a new blank slide: a table with merged cells, rich cell text, fill and borders;
  // the format painter; an icon; a SmartArt cycle; an equation
  await page.locator('[data-testid="slide-thumb"]').last().click();
  const tIdx = await page.evaluate(() => window.__slides().length);
  await page.locator('[data-testid="tb-new-slide"]').click();
  await page.locator('[data-testid="new-slide-blank"]').click();
  await page.waitForFunction((n) => window.__slides().length === n + 1 && window.__slides()[n].layout === "blank", tIdx);
  const elsAt = (i) => page.evaluate((k) => window.__slides()[k].elements, i);
  const clickEl = async (id, opts = {}) => {
    const c = await page.locator('[data-testid="slide-canvas"]').boundingBox();
    const m = await page.evaluate(() => window.__deckMeta());
    const e = (await elsAt(tIdx)).find((x) => x.id === id);
    const k = c.width / m.w;
    await page.mouse.click(c.x + (e.x + e.w / 2) * k, c.y + (e.y + e.h / 2) * k, opts);
  };
  await page.locator('[data-testid="tb-table"]').click();
  await page.locator('[data-testid="table-3x3"]').click();
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.type === "table"), tIdx);
  await page.locator('[data-testid="el-table"]').dblclick();
  const cell = (r, c) => page.locator(`[data-testid="table-cell"][data-r="${r}"][data-c="${c}"]`);
  await cell(0, 0).click();
  await page.keyboard.type("Region");
  await cell(0, 1).click({ modifiers: ["Shift"] });
  await page.locator('[data-testid="table-merge"]').click();
  await page.waitForFunction((i) => { const t = window.__slides()[i].elements.find((e) => e.type === "table"); return t?.rows[0][0].cs === 2 && t.rows[0][1].merged && t.rows[0][0].text === "Region"; }, tIdx);
  await cell(1, 0).click();
  await page.keyboard.type("North");
  await page.keyboard.press("Shift+Home");
  await page.locator('[data-testid="cell-bold"]').click();
  await page.waitForFunction((i) => /<b>North<\/b>|<strong>North<\/strong>/.test(window.__slides()[i].elements.find((e) => e.type === "table")?.rows[1][0].html || ""), tIdx);
  await cell(1, 1).click();
  await page.keyboard.type("42");
  await page.locator('[data-testid="tb-cell-fill"]').click();
  await page.locator('[data-testid="tb-cell-fill"]').locator("xpath=..").locator('button[title="#FFC000"]').click();
  await page.locator('[data-testid="tb-cell-borders"]').click();
  await page.locator('[data-testid="border-w-3"]').click();
  await page.locator('[data-testid="border-outer"]').click();
  await page.waitForFunction((i) => { const c = window.__slides()[i].elements.find((e) => e.type === "table")?.rows[1][1]; return c?.fill === "FFC000" && c.bd?.t?.w === 3 && c.bd?.r?.w === 3 && c.text === "42"; }, tIdx);
  await page.screenshot({ path: path.join(OUT, "2j-table.png") });
  await page.keyboard.press("Escape");
  log("table: merged cells, bold cell text, cell fill and borders");
  // format painter: the ellipse takes the rectangle's fill
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-rect"]').click();
  for (let k = 0; k < 40; k++) await page.keyboard.press("Shift+ArrowLeft");
  await page.locator('[data-testid="tb-fill"]').click();
  await page.locator('[data-testid="tb-fill"]').locator("xpath=..").locator('button[title="#ED7D31"]').click();
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-ellipse"]').click();
  for (let k = 0; k < 40; k++) await page.keyboard.press("Shift+ArrowRight");
  const shp = async (name) => (await elsAt(tIdx)).find((e) => e.shape === name);
  await clickEl((await shp("rect")).id);
  await page.locator('[data-testid="tb-painter"]').click();
  await clickEl((await shp("ellipse")).id);
  await page.waitForFunction((i) => window.__slides()[i].elements.find((e) => e.shape === "ellipse")?.fill === "ED7D31", tIdx);
  log("format painter copied the rectangle's fill onto the ellipse");
  // icon
  await page.locator('[data-testid="tb-icon"]').click();
  await page.locator('[data-testid="icon-search"]').fill("rocket");
  await page.locator('[data-testid="icon-rocket"]').click();
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.shape === "freeform" && e.fill === null && e.lineW > 2 && e.geom?.w === 24), tIdx);
  for (let k = 0; k < 20; k++) await page.keyboard.press("Shift+ArrowUp");
  // SmartArt cycle
  await page.locator('[data-testid="tb-smartart"]').click();
  await page.locator('[data-testid="diagram-cycle"]').click();
  await page.waitForSelector('[data-testid="diagram-preview"] [data-testid="el-shape"], [data-testid="diagram-preview"] svg');
  await page.locator('[data-testid="diagram-insert"]').click();
  await page.waitForFunction((i) => { const els = window.__slides()[i].elements.filter((e) => e.shape === "ellipse" && /Plan|Do|Check|Act/.test(e.html || "")); return els.length === 4 && els.every((e) => e.group && e.group === els[0].group); }, tIdx);
  // a group selects as a whole: move it down
  for (let k = 0; k < 8; k++) await page.keyboard.press("Shift+ArrowDown");
  log("icon inserted as a vector shape; SmartArt cycle inserted as one group");
  // equation
  await page.locator('[data-testid="tb-math"]').click();
  await page.locator('[data-testid="math-preset"]').selectOption({ label: "Quadratic formula" });
  await page.waitForSelector('[data-testid="math-preview"] math mfrac');
  await page.locator('[data-testid="math-apply"]').click();
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.type === "math" && /\\frac/.test(e.latex)), tIdx);
  await page.waitForSelector('[data-testid="slide-canvas"] [data-testid="math"] math msqrt');
  const mathBox = await page.locator('[data-testid="slide-canvas"] [data-testid="math"] math').boundingBox();
  assert.ok(mathBox.width > 80 && mathBox.height > 30, "the equation is drawn as MathML");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(OUT, "2j-inserts.png") });
  log("equation inserted from the editor and drawn with MathML");

  const edited = await page.evaluate(() => window.__slides());
  const hl = edited.find((s) => s.title === "Highlights (edited)");
  assert.ok(hl, "title edited");
  assert.match(hl.body, /Added in the web browser/);
  assert.equal(hl.notes, "Edited notes");
  assert.ok(hl.elements.some((e) => e.type === "text" && /A new text box/.test(e.html)));
  const starEl = hl.elements.find((e) => e.type === "shape" && e.shape === "star5");
  assert.ok(starEl, "star inserted");
  assert.ok(starEl.x > meta.w / 2 - starEl.w / 2 + 20, "star moved by drag");
  await page.screenshot({ path: path.join(OUT, "2-edited.png") });
  log("edited title/body/notes, added text box + shape, dragged shape, reordered slides");

  // 3) export, then re-import the export into a fresh deck and compare
  const bytes = await page.evaluate(() => window.__exportPptxBytes());
  const exported = path.join(OUT, "exported.pptx");
  writeFileSync(exported, Buffer.from(bytes));
  await openNewDeck(page);
  await importInto(page, exported);
  await page.waitForFunction((n) => window.__slides().length === n, edited.length);
  const again = await page.evaluate(() => window.__slides());
  assert.deepEqual(summary(again), summary(edited));
  const chartOf = (ss) => ss.flatMap((s) => s.elements).find((e) => e.type === "chart" && e.valAx);
  assert.deepEqual(chartOf(again).valAx, chartOf(edited).valAx, "axis formatting survives the round trip");
  assert.deepEqual(chartOf(again).series[0].trend, chartOf(edited).series[0].trend, "the trendline survives the round trip");
  const fxStr = (a) => `${a.kind || "entr"}:${a.effect}:${a.dir || ""}:${a.start}:${a.path || ""}`;
  const animOf = (ss) => ss.map((s) => ({ t: s.trans?.type || null, a: s.elements.filter((e) => e.anim).map((e) => `${e.id}:${[e.anim, ...(e.fx || [])].map(fxStr).join("|")}`) }));
  assert.deepEqual(animOf(again), animOf(edited));
  assert.ok(animOf(again).some((x) => x.t === "push" && x.a.length === 1), "transition and animation survive the round trip");
  const lookOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.grad || e.shadow || e.crop).map((e) => JSON.stringify([e.type, e.grad, e.shadow, e.crop])));
  assert.deepEqual(lookOf(again), lookOf(edited));
  assert.equal(lookOf(again).length, 2, "gradient, shadow and crop survive the round trip");
  const mediaOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.type === "media").map((e) => [e.kind, e.mime, !!e.autoplay, !!e.loop, !!e.poster, e.src.startsWith("/api/docs/")]));
  assert.deepEqual(mediaOf(again), [["video", "video/webm", true, true, true, true]], "the video is embedded, re-uploaded and keeps its settings");
  const chartsOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.type === "chart").map((e) => ({ id: e.id, t: e.chartType, d: e.barDir, st: !!e.stacked, l: !!e.dataLabels, c: e.categories, s: e.series.map((x) => [x.name, x.values]) })));
  assert.deepEqual(chartsOf(again), chartsOf(edited));
  assert.equal(chartsOf(again).length, 1, "chart survives the round trip");
  const richOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.type === "text" && /=mc/.test(e.html)).map((e) => e.html));
  assert.equal(richOf(again).length, 1);
  assert.ok(richOk(richOf(again)[0]), `rich text survives the round trip: ${richOf(again)[0]}`);
  const groupsOf = (ss) => ss.map((s) => { const g = new Map(); s.elements.forEach((e) => e.group && g.set(e.group, [...(g.get(e.group) || []), e.id].sort())); return [...g.values()].map((v) => v.join(",")).sort(); });
  assert.deepEqual(groupsOf(again), groupsOf(edited));
  assert.ok(groupsOf(again).some((g) => g.length === 1), "group survives the round trip");
  const meta2 = await page.evaluate(() => window.__deckMeta());
  assert.deepEqual([meta2.w, meta2.h, meta2.theme], [meta.w, meta.h, meta.theme]);
  assert.deepEqual([meta2.colors, meta2.headFont, meta2.hf], [look.colors, look.headFont, look.hf], "theme edits and header/footer survive");
  assert.deepEqual(again.map((s) => s.sec), edited.map((s) => s.sec), "sections survive");
  assert.deepEqual(again.map((s) => s.bg), edited.map((s) => s.bg), "slide backgrounds survive");
  const m2 = await page.evaluate(() => window.__masters());
  // the path box may be rescaled on export (icons are drawn on a 24px canvas); its shape is what counts
  const freeOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.shape === "freeform").map((e) => [Math.round((e.geom.w / e.geom.h) * 100), e.geom.d.split(" ").length, e.fill]));
  assert.deepEqual(freeOf(again), freeOf(edited), "freeform survives the round trip");
  const tableOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.type === "table" && e.rows[0][0].cs).map((e) => e.rows.map((r) => r.map((c) => [c.text, !!c.merged, c.cs || 1, c.fill || "", c.bd?.t?.w || 0, !!c.text && (!!c.bold || /<(b|strong)>/.test(c.html || ""))]))));
  assert.equal(tableOf(again).length, 1);
  assert.deepEqual(tableOf(again), tableOf(edited), "merged cells, fills, borders and bold cell text survive the round trip");
  const flat = (l) => l.replace(/\{(\\?\w)\}/g, "$1");
  const mathOf = (ss) => ss.flatMap((s) => s.elements.filter((e) => e.type === "math").map((e) => [flat(e.latex), e.size]));
  assert.deepEqual(mathOf(again), mathOf(edited), "the equation survives as Office Math");
  const brk = Object.entries(m2).find(([, m]) => m?.lname === "Section Break");
  assert.ok(brk && brk[1].elements.length === 1, "custom layout survives with its object");
  assert.equal(again[fxIdx].clayout, brk[0].slice(2));
  assert.equal(m2.master?.elements.length, 1);
  assert.equal(m2.master?.tstyle?.color, "AA0000");
  assert.equal(m2.title?.bg, "FFF7ED");
  // the comment travels in the .pptx and becomes a thread on the new deck
  const docComments = () => page.evaluate(async () => (await (await fetch(`/api/docs/${location.pathname.split("/").pop()}/comments`)).json()).threads);
  const ct = await docComments();
  assert.equal(ct.length, 1);
  assert.deepEqual(ct[0].messages.map((m) => m.body), ["Check the formula @shane@example.com", "Will do"]);
  assert.match(ct[0].quote, new RegExp(`^@slide/${again.find((s) => s.title === "Highlights (edited)").id}/`));
  // geometry survives within a pixel
  for (let i = 0; i < edited.length; i++) {
    const a = [...edited[i].elements].sort((x, y) => x.z - y.z), b = [...again[i].elements].sort((x, y) => x.z - y.z);
    a.forEach((e, k) => ["x", "y", "w", "h"].forEach((p) => assert.ok(Math.abs(e[p] - b[k][p]) <= 1, `slide ${i + 1} element ${k} ${p}: ${e[p]} vs ${b[k][p]}`)));
  }
  await page.screenshot({ path: path.join(OUT, "3-reimported.png") });
  log(`export → re-import round trip matches (${again.length} slides)`);

  // 4) slide show + presenter view
  await page.keyboard.press("F5");
  await page.waitForSelector('[data-testid="slideshow"]');
  // walk to the animated slide: the animated shape is hidden until the next click
  const ai = again.findIndex((s) => s.elements.some((e) => e.anim));
  for (let i = 0; i < ai; i++) await page.keyboard.press("ArrowRight");
  await page.waitForSelector('[data-testid="slideshow"] [data-anim-hidden="1"]', { state: "attached" });
  await page.waitForTimeout(1000); // let the push transition finish
  await page.screenshot({ path: path.join(OUT, "4-show-before-build.png") });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => !document.querySelector('[data-testid="slideshow"] [data-anim-hidden="1"]'));
  await page.waitForTimeout(700); // fly-in duration
  await page.screenshot({ path: path.join(OUT, "4-show.png") });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByText("Presenter view").click();
  await page.waitForSelector('[data-testid="presenter"]');
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: path.join(OUT, "5-presenter.png") });
  await page.keyboard.press("Escape");
  log("slide show and presenter view open, navigate and close");

  // 4b) laser pointer and pen ink (kept on the slide afterwards)
  await page.locator('[data-testid="slide-thumb"]').first().click();
  await page.keyboard.press("F5");
  await page.waitForSelector('[data-testid="slideshow"]');
  await page.keyboard.press("Control+l");
  await page.waitForSelector('[data-testid="slideshow"][data-tool="laser"]');
  const stage = await page.locator('[data-testid="show-stage"]').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.move(stage.x + stage.width / 2 + 20, stage.y + stage.height / 2 + 10);
  await page.waitForSelector('[data-testid="laser-dot"]');
  await page.screenshot({ path: path.join(OUT, "4b-laser.png") });
  await page.locator('[data-testid="show-tool-pen"]').click();
  await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.6);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(stage.x + stage.width * (0.3 + k * 0.02), stage.y + stage.height * (0.6 + Math.sin(k / 2) * 0.05));
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="ink-layer"] polyline').length === 1);
  await page.screenshot({ path: path.join(OUT, "4b-ink.png") });
  await page.keyboard.press("Escape"); // pen off
  await page.waitForSelector('[data-testid="slideshow"][data-tool="none"]');
  page.removeAllListeners("dialog");
  page.once("dialog", (d) => { assert.match(d.message(), /ink/); d.accept(); });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  await page.waitForFunction(() => window.__slides()[0].elements.some((e) => e.shape === "freeform" && e.line === "E81123" && e.fill === null));
  log("laser pointer shown; pen ink kept on the slide as a shape");

  // 4c) rehearse timings: every slide gets an "advance after" time
  await page.getByRole("button", { name: "Slide Show", exact: true }).click();
  await page.getByText("Rehearse timings").click();
  await page.waitForSelector('[data-testid="rehearse-bar"]');
  await page.waitForTimeout(1300);
  const nSlides = await page.evaluate(() => window.__slides().filter((s) => !s.hidden).length);
  for (let k = 0; k < 60 && (await page.locator('[data-testid="rehearse-bar"]').count()); k++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
  }
  page.removeAllListeners("dialog");
  page.once("dialog", (d) => { assert.match(d.message(), /Keep the new slide timings/); d.accept(); });
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  await page.waitForFunction((n) => window.__slides().filter((s) => s.trans?.advAfter >= 100).length === n, nSlides);
  const firstTime = await page.evaluate(() => window.__slides()[0].trans.advAfter);
  assert.ok(firstTime >= 1200, `first slide rehearsed for ${firstTime} ms`);
  log(`rehearsed timings saved on ${nSlides} slides`);

  // 4d) a custom show of two slides, and loop until Esc
  await page.getByRole("button", { name: "Slide Show", exact: true }).click();
  await page.getByText("Custom shows…").click();
  await page.locator('[data-testid="custom-show-new"]').click();
  await page.locator('[data-testid="custom-show-name"]').fill("Short version");
  const boxes = page.locator('[data-testid="custom-show-all"] input[type=checkbox]');
  await boxes.nth(2).check();
  await boxes.nth(0).check();
  await page.locator('[data-testid="custom-show-add"]').click();
  await page.locator('[data-testid="custom-show-ok"]').click();
  await page.waitForFunction(() => window.__deckMeta().shows?.[0]?.slides.length === 2);
  await page.locator('[data-testid="custom-show-start"]').click();
  await page.waitForSelector('[data-testid="slideshow"]');
  await page.locator('[data-testid="slideshow"]').hover();
  await page.waitForFunction(() => /1 \/ 2/.test(document.querySelector('[data-testid="show-controls"]')?.textContent || ""));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  await page.getByRole("button", { name: "Slide Show", exact: true }).click();
  await page.getByText("Loop until Esc").click();
  await page.waitForFunction(() => window.__deckMeta().show?.loop === true);
  await page.getByRole("button", { name: "Slide Show", exact: true }).click();
  await page.getByText("Use timings").click(); // manual advance, so the loop is ours to drive
  await page.waitForFunction(() => window.__deckMeta().show?.useTimings === false);
  await page.keyboard.press("F5");
  await page.waitForSelector('[data-testid="slideshow"]');
  await page.keyboard.press("End");
  for (let k = 0; k < 8; k++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  assert.equal(await page.getByText("End of slide show").count(), 0, "a looping show starts again instead of ending");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  const showBytes = await page.evaluate(() => window.__exportPptxBytes());
  const sz = await JSZip.loadAsync(Buffer.from(showBytes));
  assert.match(await sz.file("ppt/presentation.xml").async("string"), /<p:custShow name="Short version" id="0"><p:sldLst><p:sld r:id="rId\d+"\/><p:sld r:id="rId\d+"\/>/);
  assert.match(await sz.file("ppt/presProps.xml").async("string"), /<p:showPr loop="1" showNarration="1" useTimings="0">/);
  log("custom show presents its two slides; loop until Esc; both saved in the .pptx");

  // 5) custom slide size: widescreen, content fitted and centred
  const sizeBefore = await page.evaluate(() => window.__slides());
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByText("Custom slide size…").click();
  await page.locator('[data-testid="size-preset"]').selectOption("16:9");
  await page.locator('[data-testid="size-fit"]').check();
  await page.locator('[data-testid="size-apply"]').click();
  await page.waitForFunction(() => window.__deckMeta().w === 1280 && window.__deckMeta().h === 720);
  const sizeAfter = await page.evaluate(() => window.__slides());
  const e0 = sizeBefore.flatMap((s) => s.elements)[0], e1 = sizeAfter.flatMap((s) => s.elements)[0];
  assert.ok(Math.abs(e1.x - (e0.x + 160)) <= 1 && Math.abs(e1.w - e0.w) <= 1, `content keeps its size and is centred: ${e0.x} -> ${e1.x}`);
  log("custom slide size dialog: 4:3 -> 16:9 with content centred");

  // 6) deleting the deck deletes its media
  const mediaUrl = sizeAfter.flatMap((s) => s.elements).find((e) => e.type === "media").src;
  assert.equal(await page.evaluate(async (u) => (await fetch(u, { headers: { Range: "bytes=0-0" } })).status, mediaUrl), 206);
  const deckId = await page.evaluate(() => location.pathname.split("/").pop());
  assert.equal(await page.evaluate(async (id) => (await fetch(`/api/docs/${id}`, { method: "DELETE" })).status, deckId), 200);
  assert.equal(await page.evaluate(async (u) => (await fetch(u, { cache: "no-store" })).status, mediaUrl), 404);
  log("deleting the presentation deleted its video");

  // 7) PDF, OpenDocument, version history and shrink-to-fit scales, on a fresh copy of the exported deck
  await openNewDeck(page);
  await importInto(page, exported);
  await page.waitForFunction((n) => window.__slides().length === n, edited.length);
  const deck7 = await page.evaluate(() => window.__slides());
  const shown7 = deck7.filter((s) => !s.hidden).length;
  const pageCount = (b) => (Buffer.from(b).toString("latin1").match(/\/Type \/Page\b/g) || []).length;
  const pdfSlides = await page.evaluate(() => window.__exportPdfBytes({ layout: "slides" }));
  assert.equal(Buffer.from(pdfSlides.slice(0, 8)).toString("latin1"), "%PDF-1.4");
  assert.equal(pageCount(pdfSlides), shown7, "one page per shown slide");
  const pdfHand = await page.evaluate(() => window.__exportPdfBytes({ layout: "handouts", perPage: 6 }));
  assert.equal(pageCount(pdfHand), Math.ceil(shown7 / 6));
  const pdfNotes = await page.evaluate(() => window.__exportPdfBytes({ layout: "notes" }));
  assert.ok(pageCount(pdfNotes) >= shown7);
  // from the menu: notes pages
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("Download as PDF…").click();
  await page.locator('[data-testid="pdf-layout-notes"]').check();
  const [pdfDl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.locator('[data-testid="pdf-export"]').click()]);
  assert.match(pdfDl.suggestedFilename(), / \(notes\)\.pdf$/);
  const pdfFile = path.join(OUT, "notes.pdf");
  await pdfDl.saveAs(pdfFile);
  log(`PDF: ${pageCount(pdfSlides)} slide pages, ${pageCount(pdfHand)} handout page(s), ${pageCount(pdfNotes)} notes pages; downloaded from the menu`);

  // OpenDocument: export, open in a new deck, compare
  const odp = path.join(OUT, "exported.odp");
  writeFileSync(odp, Buffer.from(await page.evaluate(() => window.__exportOdpBytes())));
  await page.getByRole("button", { name: "File", exact: true }).click();
  const [odpDl] = await Promise.all([page.waitForEvent("download"), page.getByText("Download as OpenDocument (.odp)").click()]);
  assert.match(odpDl.suggestedFilename(), /\.odp$/);
  await openNewDeck(page);
  await importInto(page, odp);
  await page.waitForFunction((n) => window.__slides().length === n, deck7.length);
  const fromOdp = await page.evaluate(() => window.__slides());
  assert.deepEqual(summary(fromOdp), summary(deck7));
  assert.deepEqual(chartOf(fromOdp).valAx, chartOf(deck7).valAx, "axis formatting survives .odp");
  log(`.odp export → import round trip matches (${fromOdp.length} slides)`);

  // version history: a named version, an edit, preview and restore
  const vi = fromOdp.findIndex((s) => s.title && s.layout !== "blank");
  await page.locator('[data-testid="slide-thumb"]').nth(vi).click();
  const title0 = fromOdp[vi].title;
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("Version history").click();
  await page.locator('[data-testid="version-name"]').fill("Before the rename");
  await page.locator('[data-testid="version-save"]').click();
  await page.waitForSelector('[data-testid="version-item"][data-label="Before the rename"]');
  page.once("dialog", (d) => d.accept("Milestone A"));
  await page.locator('[data-testid="version-item"][data-label="Before the rename"]').hover();
  await page.locator('[data-testid="version-item"][data-label="Before the rename"] [data-testid="version-rename"]').click();
  await page.waitForSelector('[data-testid="version-item"][data-label="Milestone A"]');
  await page.locator('[data-testid="slide-title"]').fill("Renamed after the version");
  await page.waitForFunction((i) => window.__slides()[i].title === "Renamed after the version", vi);
  await page.locator('[data-testid="version-item"][data-label="Milestone A"] button').first().click();
  await page.waitForSelector('[data-testid="version-preview"] [data-testid="version-slide"]');
  page.once("dialog", (d) => d.accept());
  await page.locator('[data-testid="version-restore"]').click();
  await page.waitForFunction(([i, t]) => window.__slides()[i].title === t, [vi, title0]);
  await page.waitForSelector('[data-testid="version-item"][data-label="Before restore"]');
  log("version history: named, renamed, previewed and restored (the pre-restore state saved as a version)");

  // shrink text on overflow: the scale shown here is written as the autofit font scale
  await page.locator('[data-testid="slide-thumb"]').last().click();
  const nFit = await page.evaluate(() => window.__slides().length);
  await page.locator('[data-testid="tb-new-slide"]').click();
  await page.locator('[data-testid="new-slide-content"]').click();
  await page.waitForFunction((n) => window.__slides().length === n + 1, nFit);
  await page.locator('[data-testid="slide-body"]').click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "slide-body");
  for (let i = 0; i < 24; i++) {
    await page.keyboard.type(`Overflowing line ${i + 1}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction((n) => (window.__slides()[n].body.match(/Overflowing/g) || []).length === 24, nFit);
  const fitBytes = await page.evaluate(() => window.__exportPptxBytes());
  const fitZip = await JSZip.loadAsync(Buffer.from(fitBytes));
  const fitXml = await fitZip.file(`ppt/slides/slide${nFit + 1}.xml`).async("string");
  const bodySp = [...fitXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((x) => x.includes('name="syn-body"'));
  const fontScale = Number(/<a:normAutofit fontScale="(\d+)"/.exec(bodySp)?.[1]);
  assert.ok(fontScale > 10000 && fontScale < 100000, `overflowing body written with a font scale: ${fontScale}`);
  log(`shrink text on overflow: body written with fontScale ${fontScale / 1000}%`);

  // 2m) a new deck: formatted title runs, a layout picture placeholder filled from the slide,
  // Table Design, gradient stops, polygon freeform, combo chart, several objects resized together,
  // a triggered effect with a sound and a drawn motion path, the canvas media player, an updating date
  await openNewDeck(page);
  const xmlOf = async (part) => (await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.__exportPptxBytes())))).file(part).async("string");
  await page.locator('[data-testid="slide-title"]').click();
  await page.keyboard.type("Quarterly Review");
  await page.waitForFunction(() => window.__slides()[0].title === "Quarterly Review");
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(150);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyI");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => window.__slides()[0].title === "Quarterly Review" && /<em>Review<\/em>/.test(window.__slides()[0].thtml || ""));
  assert.match(await xmlOf("ppt/slides/slide1.xml"), /<a:t>Quarterly <\/a:t>[\s\S]*?<a:rPr[^>]*\bi="1"[^>]*>[\s\S]*?<a:t>Review<\/a:t>/, "the italic word is its own run");
  await page.keyboard.press("Escape");
  log("title with an italic word, written as its own run");

  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.getByText("Slide master", { exact: true }).click();
  await page.waitForSelector('[data-testid="master-panel"]');
  await page.locator('[data-testid="master-thumb"][data-key="titleOnly"]').click();
  await page.locator('[data-testid="layout-placeholder"]').selectOption("pic");
  await page.waitForFunction(() => window.__masters().titleOnly?.elements.some((e) => e.slot === "pic"));
  await page.locator('[data-testid="master-close"]').click();
  await page.waitForSelector('[data-testid="slide-rail"]');
  const newSlide = async (kind) => {
    const n = await page.evaluate(() => window.__slides().length);
    await page.locator('[data-testid="slide-thumb"]').last().click();
    await page.locator('[data-testid="tb-new-slide"]').click();
    await page.locator(`[data-testid="new-slide-${kind}"]`).click();
    await page.waitForFunction((k) => window.__slides().length === k + 1, n);
    return n;
  };
  const sIdx = await newSlide("titleOnly");
  await page.waitForSelector('[data-testid="slot-pic"]');
  const dot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator('[data-testid="slot-pic"]').click()]);
  await chooser.setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(dot, "base64") });
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.type === "image" && e.ph), sIdx);
  await page.waitForSelector('[data-testid="slot-pic"]', { state: "detached" });
  assert.match(await xmlOf(`ppt/slides/slide${sIdx + 1}.xml`), /<p:ph type="pic" idx="20"\/>/);
  log("picture placeholder added to a layout, filled on a slide, written as a PowerPoint picture placeholder");

  const tIdx2 = await newSlide("blank");
  await page.locator('[data-testid="tb-table"]').click();
  await page.locator('[data-testid="table-3x3"]').click();
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.type === "table"), tIdx2);
  await page.locator('[data-testid="el-table"]').dblclick();
  await page.locator('[data-testid="tb-table-design"]').click();
  await page.locator('[data-testid="table-style-073a0daa"]').click();
  await page.locator('[data-testid="table-flag-last"]').check();
  await page.waitForFunction((i) => { const t = window.__slides()[i].elements.find((e) => e.type === "table")?.tstyle; return t?.id === "{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}" && t.last && t.first && t.bandRow; }, tIdx2);
  const tx = await xmlOf(`ppt/slides/slide${tIdx2 + 1}.xml`);
  assert.match(tx, /<a:tblPr firstRow="1" lastRow="1" bandRow="1"><a:tableStyleId>\{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9\}<\/a:tableStyleId>/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  log("Table Design: Medium Style 2 with header, total row and banded rows, written as tableStyleId and flags");

  const gIdx = await newSlide("blank");
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-rect"]').click();
  await page.locator('[data-testid="tb-fill"]').click();
  const bar = await page.locator('[data-testid="grad-bar"]').boundingBox();
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.locator('[data-testid="grad-stop-color"]').fill("#00b050");
  await page.locator('[data-testid="grad-apply"]').click();
  await page.waitForFunction((i) => { const g = window.__slides()[i].elements.find((e) => e.shape === "rect")?.grad; return g?.stops.length === 3 && g.stops.some((x) => x.color === "00B050"); }, gIdx);
  assert.equal((await xmlOf(`ppt/slides/slide${gIdx + 1}.xml`)).match(/<a:gs pos=/g)?.length, 3, "three gradient stops written");
  log("gradient with a third stop added on the bar");

  // polygon: three corners, then the first again to close
  await page.locator('[data-testid="tb-pen-poly"]').click();
  const pl2 = await page.locator('[data-testid="pen-layer"]').boundingBox();
  const P = (fx, fy) => [pl2.x + pl2.width * fx, pl2.y + pl2.height * fy];
  for (const [fx, fy] of [[0.1, 0.7], [0.3, 0.7], [0.2, 0.9], [0.1, 0.7]]) await page.mouse.click(...P(fx, fy));
  await page.waitForFunction((i) => window.__slides()[i].elements.some((e) => e.shape === "freeform" && /^M[^C]*Z$/.test((e.geom?.d || "").trim())), gIdx);
  await page.keyboard.press("Escape");
  log("polygon freeform of straight sides, closed on its first corner");

  // two shapes resized together from the selection's corner handle
  await page.locator('[data-testid="tb-select-all-objects"]').click();
  const before2 = await page.evaluate((i) => window.__slides()[i].elements.map((e) => [e.w, e.h]), gIdx);
  const se = await page.locator('[data-testid="group-handle-se"]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 60, se.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(([i, b]) => window.__slides()[i].elements.every((e, k) => e.w > b[k][0] && e.h > b[k][1]), [gIdx, before2]);
  await page.keyboard.press("Escape");
  log("both objects resized together from the selection handle");

  const cIdx = await newSlide("blank");
  await page.locator('[data-testid="tb-chart"]').click();
  await page.locator('[data-testid="chart-insert-bar"]').click();
  await page.locator('[data-testid="tb-chart-edit"]').click();
  const combo = page.locator('[data-testid="chart-combo"]');
  if (!(await combo.evaluate((d) => d.open))) await combo.locator("summary").click();
  await page.locator('[data-testid="chart-series-type-1"]').selectOption("line");
  await page.locator('[data-testid="chart-series-y2-1"]').check();
  await page.waitForFunction((i) => { const c = window.__slides()[i].elements.find((e) => e.type === "chart"); return c?.series[1].type === "line" && c.series[1].y2; }, cIdx);
  await page.keyboard.press("Escape");
  const zc = await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.__exportPptxBytes())));
  const chartXml = await zc.file(Object.keys(zc.files).find((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).async("string");
  assert.match(chartXml, /<c:barChart>[\s\S]*<c:lineChart>/, "column and line in one plot area");
  log("combo chart: a column series and a line series on the secondary axis");

  // a triggered effect with a sound, and a motion path drawn as straight lines
  const aIdx = await newSlide("blank");
  for (const sh of ["rect", "ellipse"]) {
    await page.locator('[data-testid="tb-shapes"]').click();
    await page.locator(`[data-testid="shape-${sh}"]`).click();
    if (sh === "rect") for (let k = 0; k < 30; k++) await page.keyboard.press("Shift+ArrowLeft");
  }
  const ids = await page.evaluate((i) => Object.fromEntries(window.__slides()[i].elements.map((e) => [e.shape, e.id])), aIdx);
  await page.locator(`[data-el-id="${ids.rect}"]`).click();
  if (!(await page.locator('[data-testid="anim-panel"]').count())) await page.locator('[data-testid="tb-anim"]').click();
  await page.locator('[data-testid="anim-effect"]').selectOption("fade");
  await page.locator('[data-testid="anim-trigger"]').selectOption(ids.ellipse);
  await page.locator('[data-testid="anim-sound"]').selectOption("builtin:chime");
  await page.locator('[data-testid="anim-add-path"]').click();
  await page.locator('[data-testid="anim-path-draw-lines-1"]').click();
  const ml = await page.locator('[data-testid="motion-layer"]').boundingBox();
  await page.mouse.click(ml.x + ml.width * 0.3, ml.y + ml.height * 0.3);
  await page.mouse.dblclick(ml.x + ml.width * 0.6, ml.y + ml.height * 0.5);
  await page.waitForSelector('[data-testid="motion-layer"]', { state: "detached" });
  await page.waitForFunction(([i, id]) => { const e = window.__slides()[i].elements.find((x) => x.id === id); return e.anim?.trigger && e.anim.sound?.src === "builtin:chime" && /^M 0 0 L/.test(e.fx?.[0]?.path || ""); }, [aIdx, ids.rect]);
  const ax = await xmlOf(`ppt/slides/slide${aIdx + 1}.xml`);
  assert.match(ax, /nodeType="interactiveSeq"/);
  assert.match(ax, /<p:sndTgt r:embed="rIdSynSnd1"/);
  await page.keyboard.press("Escape");
  log("effect started by clicking another object, with a sound; a motion path drawn as lines");

  // the canvas media player: a short WAV tone, played in place
  const mIdx = await newSlide("blank");
  const rate = 8000, n = rate; // one second
  const wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < n; k++) wav.writeInt16LE(Math.round(Math.sin((k / rate) * 2 * Math.PI * 440) * 8000), 44 + k * 2);
  await page.setInputFiles('[data-testid="media-input"]', { name: "tone.wav", mimeType: "audio/wav", buffer: wav });
  await page.waitForFunction((i) => window.__slides()[i].elements.some((x) => x.type === "media"), mIdx, { timeout: 30000 });
  await page.waitForSelector('[data-testid="media-bar"]');
  await page.locator('[data-testid="media-play"]').click();
  await page.waitForFunction(() => { const a = document.querySelector('[data-testid="canvas-audio"]'); return a && a.currentTime > 0.2; }, null, { timeout: 15000 });
  await page.locator('[data-testid="media-play"]').click();
  log("audio played in place on the canvas from the media bar");

  // a date that updates by itself
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByText("Header & footer…").click();
  await page.locator('[data-testid="hf-date"]').check();
  await page.locator('[data-testid="hf-date-auto"]').check();
  await page.locator('[data-testid="hf-apply"]').click();
  await page.waitForFunction(() => !!window.__deckMeta().hf?.dateAuto);
  assert.match(await xmlOf("ppt/slides/slide2.xml"), /<a:fld id="\{[0-9A-F-]+\}" type="datetime\d*"/);
  log("date written as a PowerPoint date field");

  // File > Make a copy opens the copy, slides and all
  const nCopy = await page.evaluate(() => window.__slides().length);
  const [copy] = await Promise.all([page.context().waitForEvent("page", { timeout: 60000 }), (async () => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByText("Make a copy", { exact: true }).click();
  })()]);
  await copy.waitForURL(/\/slides\//, { timeout: 60000 });
  await copy.waitForFunction((k) => typeof window.__slides === "function" && window.__slides().length === k, nCopy, { timeout: 120000 });
  assert.notEqual(new URL(copy.url()).pathname, new URL(page.url()).pathname);
  await copy.close();
  log(`Make a copy: a new presentation with all ${nCopy} slides`);

  const last = await devIssues(page);
  if (last) issuesSeen.push(last);
  assert.deepEqual(issuesSeen, [], `the Next.js dev overlay reports: ${issuesSeen.join("\n")}`);
  log("no issues in the Next.js dev overlay");

  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
