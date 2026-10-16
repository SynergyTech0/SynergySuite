// Browser check for presenting live and the last Slides round: subtitles from
// speech recognition (a stand-in recogniser), the audience view following the
// presenter, 3D models, and the leftovers (translucent fills, WordArt warps,
// table sizing handles, painting text formats).
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/slides-live.e2e.mjs
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const OUT = mkdtempSync(path.join(tmpdir(), "slides-e2e-"));
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
// a stand-in for the browser's speech recognition: the test says what it hears
await context.addInitScript(() => {
  class FakeRecognition {
    constructor() {
      this.lang = "";
      this.onresult = this.onerror = this.onend = null;
    }
    start() {
      window.__recognition = this;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.__hear = (phrases) => {
    const r = window.__recognition;
    if (!r) return false;
    const results = phrases.map(([t, fin]) => ({ isFinal: fin, 0: { transcript: t }, length: 1 }));
    r.onresult?.({ resultIndex: 0, results });
    return r.lang;
  };
});
const page = await context.newPage();
for (const p of [page]) {
  p.on("pageerror", (e) => console.error("pageerror:", e.message));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
}
const slides = () => page.evaluate(() => window.__slides());
const menu = async (top, item) => {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByText(item, { exact: true }).click();
};

try {
  await page.goto(`${BASE}/slides`);
  await page.waitForSelector('[data-testid="slide-canvas"]', { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__slides === "function" && window.__slides().length > 0);
  const docUrl = page.url();
  await page.locator('[data-testid="slide-title"]').fill("One");
  for (const t of ["Two", "Three"]) {
    const n = (await slides()).length;
    await page.locator('[data-testid="tb-new-slide"]').click();
    await page.locator('[data-testid="new-slide-content"]').click();
    await page.waitForFunction((k) => window.__slides().length === k + 1, n);
    await page.locator('[data-testid="slide-title"]').fill(t);
    await page.waitForFunction((x) => window.__slides().some((s) => s.title === x), t);
  }
  log(`deck of 3 slides at ${docUrl}`);

  // ---- presenter view: share the audience link ----
  await page.locator('[data-testid="slide-thumb"]').first().click();
  await menu("Slide Show", "Presenter view");
  await page.waitForSelector('[data-testid="presenter"]');
  await page.locator('[data-testid="show-follow"]').click();
  await page.locator('[data-testid="follow-start"]').click();
  const link = await page.locator('[data-testid="follow-link"]').inputValue();
  assert.match(link, /\/slides\/[\w-]+\/follow$/);
  const audience = await context.newPage();
  audience.on("pageerror", (e) => console.error("audience pageerror:", e.message));
  await audience.goto(link);
  await audience.waitForFunction(() => document.querySelector('[data-testid="follow-view"] [data-testid="show-stage"]')?.textContent?.includes("One"), null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="follow-count"]')?.textContent === "1 following");
  log("audience view opened from the link shows slide One; the presenter sees 1 following");

  await page.keyboard.press("ArrowRight");
  await audience.waitForFunction(() => document.querySelector('[data-testid="show-stage"]')?.textContent?.includes("Two"));
  log("presenter moved to Two; the audience followed");

  // ---- subtitles ----
  await page.keyboard.press("j");
  await page.waitForFunction(() => !!window.__recognition);
  const lang = await page.evaluate(() => window.__hear([["Welcome to the", false]]));
  assert.ok(lang, "recognition started with a language");
  await page.waitForFunction(() => document.querySelector('[data-testid="show-captions"]')?.textContent === "Welcome to the");
  await page.evaluate(() => window.__hear([["Welcome to the quarterly review", true], ["and", false]]));
  await page.waitForFunction(() => document.querySelector('[data-testid="show-captions"]')?.textContent === "Welcome to the quarterly review and");
  await audience.waitForFunction(() => document.querySelector('[data-testid="show-captions"]')?.textContent === "Welcome to the quarterly review and");
  await page.screenshot({ path: path.join(OUT, "1-presenter-captions.png") });
  await audience.screenshot({ path: path.join(OUT, "1-audience-captions.png") });
  // the language setting restarts recognition in that language
  await page.locator('[data-testid="show-cc-settings"]').click();
  await page.locator('[data-testid="caption-lang"]').selectOption("fr-FR");
  await page.waitForFunction(() => window.__recognition?.lang === "fr-FR");
  await page.locator('[data-testid="show-cc-settings"]').click();
  log(`subtitles: heard text shows on the presenter's slide and the audience's (${lang}, then fr-FR)`);

  // black screen follows too; then stop sharing
  await page.keyboard.press("b");
  await audience.waitForFunction(() => !document.querySelector('[data-testid="show-stage"]')?.textContent?.includes("Two"));
  await page.keyboard.press("b");
  await audience.waitForFunction(() => document.querySelector('[data-testid="show-stage"]')?.textContent?.includes("Two"));
  await page.locator('[data-testid="show-follow"]').click();
  await page.locator('[data-testid="follow-stop"]').click();
  await audience.waitForFunction(() => document.querySelector('[data-testid="follow-message"]')?.textContent?.includes("stopped sharing"));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="presenter"]', { state: "detached" });
  await audience.close();
  log("black screen followed; stopping sharing tells the audience");

  // ---- 3D model: insert, turn with the handle and the views, export ----
  const { cubeGlb } = await import("../fixtures/cube-glb.mjs");
  await page.locator('[data-testid="slide-thumb"]').nth(2).click();
  await page.locator('[data-testid="model-input"]').setInputFiles({ name: "cube.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(cubeGlb()) });
  await page.waitForFunction(() => window.__slides()[2].elements.some((e) => e.type === "model3d"), null, { timeout: 30000 });
  const m0 = await page.evaluate(() => window.__slides()[2].elements.find((e) => e.type === "model3d"));
  assert.match(m0.src, /^\/api\/docs\/[\w-]+\/media\//);
  assert.equal(m0.name, "Test cube");
  await page.waitForSelector('[data-testid="model3d-canvas"][data-drawn="1"]', { timeout: 30000 });
  await page.waitForFunction(() => /^data:image\/png/.test(window.__slides()[2].elements.find((e) => e.type === "model3d").poster || ""), null, { timeout: 30000 });
  // the canvas shows the cube: some opaque, coloured pixels
  const painted = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="slide-canvas"] [data-testid="model3d-canvas"]');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++;
    return n / (d.length / 4);
  });
  assert.ok(painted > 0.05, `the model is drawn (${painted})`);
  await page.screenshot({ path: path.join(OUT, "2-model.png") });
  const poster0 = (await page.evaluate(() => window.__slides()[2].elements.find((e) => e.type === "model3d"))).poster;
  const hb = await page.locator('[data-testid="model3d-turn"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((ry) => window.__slides()[2].elements.find((e) => e.type === "model3d").ry !== ry, m0.ry);
  const m1 = await page.evaluate(() => window.__slides()[2].elements.find((e) => e.type === "model3d"));
  assert.ok(Math.abs(m1.ry - m0.ry - 60) < 2 && Math.abs(m1.rx - m0.rx - 20) < 2, `dragging turned it: ${m0.rx},${m0.ry} -> ${m1.rx},${m1.ry}`);
  await page.waitForFunction((p) => { const m = window.__slides()[2].elements.find((e) => e.type === "model3d"); return m.poster && m.poster !== p; }, poster0);
  await page.locator('[data-testid="tb-model-views"]').click();
  await page.locator('[data-testid="model-view-left"]').click();
  await page.waitForFunction(() => { const m = window.__slides()[2].elements.find((e) => e.type === "model3d"); return m.ry === 90 && !m.rx; });
  await page.screenshot({ path: path.join(OUT, "2-model-left.png") });
  log(`3D model inserted (${painted.toFixed(2)} of its box drawn), turned by dragging (${m1.rx}°, ${m1.ry}°) and to the Left view`);
  const pbytes = await page.evaluate(() => window.__exportPptxBytes());
  const pz = await JSZip.loadAsync(Buffer.from(pbytes));
  assert.ok(pz.file("ppt/media/model3d1.glb"), "the model is in the package");
  assert.match(await pz.file("[Content_Types].xml").async("string"), /Extension="glb"/);
  assert.match(await pz.file("ppt/slides/_rels/slide3.xml.rels").async("string"), /relationships\/model3d" Target="\.\.\/media\/model3d1\.glb"/);
  assert.match(await pz.file("docProps/custom.xml").async("string"), /SynergyModels/);
  log("the .pptx keeps the model file beside its picture");

  // ---- WordArt Transform: arch a text box, drawn on a path and kept in the .pptx ----
  await page.locator('[data-testid="slide-thumb"]').first().click();
  const nText = (await slides())[0].elements.filter((e) => e.type === "text").length;
  await page.locator('[data-testid="tb-textbox"]').click();
  await page.waitForFunction((k) => window.__slides()[0].elements.filter((e) => e.type === "text").length === k + 1, nText);
  await page.keyboard.type("Arched words");
  await page.waitForFunction(() => window.__slides()[0].elements.some((e) => e.type === "text" && /Arched words/.test(e.html)));
  const tid = await page.evaluate(() => window.__slides()[0].elements.find((e) => e.type === "text" && /Arched words/.test(e.html)).id);
  await page.keyboard.press("Escape");
  await page.locator(`[data-el-id="${tid}"]`).click({ force: true });
  await page.locator('[data-testid="tb-wordart"]').click();
  await page.locator('[data-testid="warp-textArchUp"]').click();
  await page.waitForFunction((id) => window.__slides()[0].elements.find((e) => e.id === id).warp === "textArchUp", tid);
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slide-canvas"] [data-warp="textArchUp"] textPath');
  assert.match(await page.locator('[data-testid="slide-canvas"] [data-warp="textArchUp"]').textContent(), /Arched words/);
  await page.screenshot({ path: path.join(OUT, "3-warp.png") });
  const wz = await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.__exportPptxBytes())));
  assert.match(await wz.file("ppt/slides/slide1.xml").async("string"), /<a:bodyPr[^>]*><a:prstTxWarp prst="textArchUp">/);
  log("WordArt Transform: the text box arches on screen and in the .pptx");

  // ---- animations in video export: the arched text fades in on its click ----
  await page.locator(`[data-el-id="${tid}"]`).click({ force: true });
  await page.locator('[data-testid="tb-anim"]').click();
  await page.waitForSelector('[data-testid="anim-panel"]');
  await page.locator('[data-testid="anim-effect"]').selectOption("fade");
  await page.waitForFunction((id) => window.__slides()[0].elements.find((e) => e.id === id).anim?.effect === "fade", tid);
  const vid = (anims) =>
    page.evaluate(async (opts) => {
      const r = await window.__exportVideo(opts);
      const v = document.createElement("video");
      v.muted = true;
      v.src = r.url;
      await new Promise((res) => (v.onloadedmetadata = res));
      if (!Number.isFinite(v.duration)) {
        v.currentTime = 1e9;
        await new Promise((res) => (v.ontimeupdate = res));
      }
      const duration = v.duration;
      // how much ink is on the slide at a moment (0 white .. 1 black per pixel)
      const dark = async (t) => {
        v.currentTime = t;
        await new Promise((res) => (v.onseeked = res));
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const g = c.getContext("2d");
        g.drawImage(v, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) n += 1 - (d[i] + d[i + 1] + d[i + 2]) / 765;
        return Math.round(n);
      };
      const out = { duration, before: await dark(0.3), during: await dark(1.25), after: await dark(1.8) };
      URL.revokeObjectURL(r.url);
      return out;
    }, { format: "webm", height: 720, secs: 2, recorded: false, transitions: false, animations: anims });
  const va = await vid(true);
  const vn = await vid(false);
  assert.ok(Math.abs(va.duration - vn.duration - 0.5) < 0.2, `durations ${va.duration} and ${vn.duration}`);
  const mid = (va.during - va.before) / (va.after - va.before);
  assert.ok(va.after > va.before * 1.1 && mid > 0.2 && mid < 0.8, `the text fades in: ${JSON.stringify(va)}`);
  assert.ok(Math.abs(vn.before - vn.after) < vn.after * 0.05, `without animations the text is there from the start: ${JSON.stringify(vn)}`);
  log(`video export plays the animation: ink ${va.before} → ${va.during} → ${va.after}; ${va.duration.toFixed(1)} s with, ${vn.duration.toFixed(1)} s without`);

  // ---- master text styles beyond the first level ----
  await menu("View", "Slide master");
  await page.waitForSelector('[data-testid="master-panel"]');
  await page.locator('[data-testid="master-body-level"]').selectOption("2");
  await page.locator('[data-testid="master-body-size"]').fill("30");
  await page.locator('[data-testid="master-body-size"]').press("Enter");
  await page.locator('[data-testid="master-body-color"]').fill("#aa0000");
  await page.waitForFunction(() => { const l = window.__masters().master?.bstyle?.lv?.[0]; return l?.size === 30 && l?.color === "AA0000"; });
  const lv2 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".slide-body-ph li li p")].find((x) => x.offsetParent);
    const cs = p && getComputedStyle(p);
    return cs ? { size: cs.fontSize, color: cs.color } : null;
  });
  assert.deepEqual(lv2, { size: "40px", color: "rgb(170, 0, 0)" }, "the master's second level shows its style");
  await page.screenshot({ path: path.join(OUT, "4-master-levels.png") });
  await page.locator('[data-testid="master-close"]').click();
  log("slide master: the second outline level set to 30 pt, dark red");
  // a second slide master with its own layout and background
  await menu("View", "Slide master");
  await page.waitForSelector('[data-testid="master-panel"]');
  page.once("dialog", (d) => d.accept("Dark master"));
  await page.locator('[data-testid="master-new"]').click();
  await page.waitForFunction(() => Object.entries(window.__masters()).some(([k, m]) => k.startsWith("m:") && m?.lname === "Dark master"));
  const mkey = await page.evaluate(() => Object.keys(window.__masters()).find((k) => k.startsWith("m:")));
  await page.waitForSelector(`[data-testid="master-thumb"][data-key="${mkey}"]`);
  await page.locator('[data-testid="master-bg"]').fill("#1f2937");
  await page.waitForFunction((k) => window.__masters()[k]?.bg === "1F2937", mkey);
  const lkey = await page.evaluate((k) => Object.entries(window.__masters()).find(([id, m]) => id.startsWith("c:") && m?.pm === k.slice(2))?.[0], mkey);
  assert.ok(lkey, "the new master has a layout");
  await page.screenshot({ path: path.join(OUT, "4-second-master.png") });
  await page.locator('[data-testid="master-close"]').click();
  await page.locator('[data-testid="slide-thumb"]').nth(2).click();
  const nBefore = (await slides()).length;
  await page.locator('[data-testid="tb-new-slide"]').click();
  await page.locator(`[data-testid="new-slide-${lkey}"]`).click();
  await page.waitForFunction((n) => window.__slides().length === n + 1, nBefore);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="slide-canvas"] *')].some((x) => getComputedStyle(x).backgroundColor === "rgb(31, 41, 55)"));
  const bgNow = "its background";
  const added = await page.evaluate(() => window.__slides()[3]);
  assert.equal(added.clayout, lkey.slice(2));
  log(`second slide master "Dark master" with its own layout; a new slide on it (${bgNow})`);
  await page.locator('[data-testid="slide-thumb"]').nth(3).click();
  await page.keyboard.press("Escape");

  // ---- table: drag a column border and a row border ----
  await page.locator('[data-testid="slide-thumb"]').nth(1).click();
  await page.locator('[data-testid="tb-table"]').click();
  await page.locator('[data-testid="table-3x3"]').click();
  await page.waitForFunction(() => window.__slides()[1].elements.some((e) => e.type === "table"));
  await page.locator('[data-testid="el-table"]').dblclick();
  await page.waitForSelector('[data-testid="table-col-handle"]');
  const t0 = await page.evaluate(() => window.__slides()[1].elements.find((e) => e.type === "table"));
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
  };
  await drag('[data-testid="table-col-handle"][data-i="0"]', 60, 0);
  await page.waitForFunction(() => window.__slides()[1].elements.find((e) => e.type === "table").colW?.length === 3);
  const t1 = await page.evaluate(() => window.__slides()[1].elements.find((e) => e.type === "table"));
  assert.ok(t1.colW[0] > t1.colW[1] + 40 && Math.abs(t1.w - t0.w) < 1, `the first column took width from the second: ${t1.colW}`);
  await drag('[data-testid="table-row-handle"][data-i="1"]', 0, 40);
  await page.waitForFunction(() => window.__slides()[1].elements.find((e) => e.type === "table").rowH?.length === 3);
  const t2 = await page.evaluate(() => window.__slides()[1].elements.find((e) => e.type === "table"));
  assert.ok(t2.rowH[1] > t2.rowH[0] + 30 && t2.h > t1.h + 30, `the second row and the table grew: ${t2.rowH}, ${t1.h} -> ${t2.h}`);
  await page.screenshot({ path: path.join(OUT, "5-table-sizes.png") });
  log(`table borders dragged: columns ${t1.colW.map(Math.round)}, rows ${t2.rowH.map(Math.round)}`);

  // ---- format painter between text selections ----
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="slide-body"]').click({ position: { x: 60, y: 20 } });
  await page.keyboard.type("alpha beta gamma");
  await page.waitForFunction(() => /alpha beta gamma/.test(window.__slides()[1].body));
  const wordAt = (w) =>
    page.evaluate((word) => {
      const root = document.querySelector('[data-testid="slide-body"]');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent.indexOf(word);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + word.length);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      return null;
    }, w);
  let pt = await wordAt("alpha");
  await page.mouse.dblclick(pt.x, pt.y);
  await page.keyboard.press("Control+b");
  await page.locator('select[title="Font size (pt)"]').selectOption("28");
  await page.waitForFunction(() => /font-size: 28pt[^>]*>(<strong>)?alpha|<strong>[^<]*<span[^>]*28pt[^>]*>alpha/.test(window.__slides()[1].body));
  pt = await wordAt("alpha");
  await page.mouse.dblclick(pt.x, pt.y);
  await page.locator('[data-testid="tb-text-painter"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="tb-text-painter"]')?.className.includes("indigo"));
  pt = await wordAt("beta");
  await page.mouse.dblclick(pt.x, pt.y);
  await page.waitForFunction(() => /28pt[^>]*>(<strong>)?beta|<strong>[^<]*<span[^>]*28pt[^>]*>beta/.test(window.__slides()[1].body), null, { timeout: 10000 });
  const paintedBody = await page.evaluate(() => window.__slides()[1].body);
  assert.match(paintedBody, /<strong>(<span[^>]*>)?beta|<strong>beta/, "beta is bold");
  assert.doesNotMatch(paintedBody, /28pt[^>]*>(<strong>)?\s*gamma/, "gamma is untouched");
  assert.ok(!(await page.locator('[data-testid="tb-text-painter"]').getAttribute("class")).includes("indigo-100"), "the painter turns off after one use");
  await page.screenshot({ path: path.join(OUT, "6-text-painter.png") });
  log("format painter: bold 28 pt copied from one word and painted onto another");

  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
