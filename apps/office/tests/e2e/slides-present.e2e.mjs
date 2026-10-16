// Browser check for presenting: summary/section/slide zoom and Morph in the
// slide show, zoom pictures in .pptx, Record Slide Show with narration (a fake
// microphone), export to video (WebM and MP4), and the Designer and drafting
// tools (built in, and with a stand-in AI model).
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/slides-present.e2e.mjs
// With FAKE_AI_PORT=3879 the script serves a stand-in model there; start the
// app with AI_BASE_URL=http://127.0.0.1:3879/v1 AI_MODEL=fake to test the AI tools.
// (CHROMIUM_PATH may point at a Chromium binary; NODE_PATH at a global Playwright.)
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
const log = (...a) => console.log("•", ...a);
const fakeAi = process.env.FAKE_AI_PORT ? await (await import("../fixtures/fake-ai.mjs")).startFakeAi(Number(process.env.FAKE_AI_PORT)) : null;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-proxy-server", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ["microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
const slides = () => page.evaluate(() => window.__slides());
const menu = async (top, item) => {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByText(item, { exact: true }).click();
};
const stageText = () => page.locator('[data-testid="show-stage"]').innerText();

try {
  await page.goto(`${BASE}/slides`);
  await page.waitForSelector('[data-testid="slide-canvas"]', { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__slides === "function" && window.__slides().length > 0);

  // a deck: Agenda, Plan, Build, Ship (Ship morphs from Build)
  await page.locator('[data-testid="slide-title"]').fill("Agenda");
  for (const t of ["Plan", "Build", "Ship"]) {
    const n = (await slides()).length;
    await page.locator('[data-testid="tb-new-slide"]').click();
    await page.locator('[data-testid="new-slide-content"]').click();
    await page.waitForFunction((k) => window.__slides().length === k + 1, n);
    await page.locator('[data-testid="slide-title"]').fill(t);
    await page.waitForFunction((x) => window.__slides().some((s) => s.title === x), t);
    if (t !== "Plan") {
      await page.locator('[data-testid="tb-shapes"]').click();
      await page.locator('[data-testid="shape-rect"]').click();
      await page.waitForFunction((x) => window.__slides().find((s) => s.title === x).elements.length === 1, t);
    }
  }
  // move Ship's rectangle and give Ship a morph transition
  const shipRect = (await slides())[3].elements[0];
  const box = await page.locator(`[data-el-id="${shipRect.id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((x) => window.__slides()[3].elements[0].x !== x, shipRect.x);
  await page.locator('[data-testid="tb-anim"]').click();
  await page.waitForSelector('[data-testid="anim-panel"]');
  await page.locator('[data-testid="trans-type"]').selectOption("morph");
  await page.waitForFunction(() => window.__slides()[3].trans?.type === "morph");
  await page.locator('[data-testid="tb-anim"]').click();
  log("deck of 4 slides; Ship has a Morph transition");

  // summary zoom of Plan and Ship
  await menu("Insert", "Summary zoom…");
  await page.waitForSelector('[data-testid="zoom-dialog"]');
  const plan = (await slides())[1].id, ship = (await slides())[3].id;
  await page.locator(`[data-testid="zoom-pick"][data-id="${plan}"] input`).check();
  await page.locator(`[data-testid="zoom-pick"][data-id="${ship}"] input`).check();
  await page.locator('[data-testid="zoom-insert"]').click();
  await page.waitForFunction(() => window.__slides().length === 5);
  let d = await slides();
  assert.deepEqual(d.map((s) => s.title), ["Agenda", "Summary", "Plan", "Build", "Ship"]);
  assert.deepEqual(d.map((s) => s.sec ?? null), ["Default Section", "Summary", "Plan", null, "Ship"]);
  const zooms = d[1].elements.filter((e) => e.type === "zoom");
  assert.deepEqual(zooms.map((z) => [z.kind, z.target, z.ret]), [["section", plan, true], ["section", ship, true]]);
  // the zooms draw their slides on the canvas
  await page.waitForSelector('[data-testid="slide-canvas"] [data-zoom-target] [data-el="title"]');
  await page.screenshot({ path: path.join(OUT, "1-summary.png") });
  log("summary zoom: sections Plan and Ship and a summary slide with two section zooms");

  // a slide zoom on Agenda to Build
  await page.locator('[data-testid="slide-thumb"]').nth(0).click();
  await menu("Insert", "Slide zoom…");
  await page.locator(`[data-testid="zoom-pick"][data-id="${d[3].id}"] input`).check();
  await page.locator('[data-testid="zoom-insert"]').click();
  await page.waitForFunction(() => window.__slides()[0].elements.some((e) => e.type === "zoom" && e.kind === "slide"));
  await page.locator('[data-testid="tb-zoom"]').click();
  await page.locator('[data-testid="zoom-return"]').check();
  await page.waitForFunction(() => window.__slides()[0].elements.find((e) => e.type === "zoom").ret === true);
  await page.keyboard.press("Escape");
  log("slide zoom to Build with Return to zoom");

  // slide show: click the summary's Plan zoom, present the Plan section, come back
  await page.locator('[data-testid="slide-thumb"]').nth(1).click();
  await page.keyboard.press("Shift+F5");
  await page.waitForSelector('[data-testid="slideshow"]');
  await page.waitForFunction(() => /Summary/.test(document.querySelector('[data-testid="show-stage"]')?.innerText || ""));
  const zoomBox = await page.locator(`[data-testid="show-stage"] [data-el="${zooms[0].id}"]`).boundingBox();
  await page.mouse.click(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "2-zooming.png") });
  await page.waitForFunction(() => /^\s*Plan\s*$/.test(document.querySelector('[data-testid="show-stage"]').innerText), null, { timeout: 5000 });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => /Build/.test(document.querySelector('[data-testid="show-stage"]').innerText) && !/Plan/.test(document.querySelector('[data-testid="show-stage"]').innerText));
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => /Summary/.test(document.querySelector('[data-testid="show-stage"]').innerText), null, { timeout: 5000 });
  log("slide show: the section zoom presented Plan and Build, then returned to the summary");
  // Morph: Build -> Ship moves the rectangle
  await page.keyboard.press("Home");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => /Build/.test(document.querySelector('[data-testid="show-stage"]').innerText));
  await page.waitForTimeout(1200);
  await page.keyboard.press("ArrowRight");
  const morphing = await (await page.waitForFunction(() => {
    const t = document.getAnimations().map((a) => a.effect?.getKeyframes?.()[0]).filter((k) => k && "translate" in k).map((k) => k.translate);
    return t.length ? t : null;
  }, null, { timeout: 5000, polling: 20 })).jsonValue();
  assert.ok(morphing.length >= 2, `morph moves the title and the rectangle: ${JSON.stringify(morphing)}`);
  assert.ok(morphing.some((t) => t !== "0px 0px"), "the rectangle starts where it was on Build");
  await page.screenshot({ path: path.join(OUT, "3-morph.png") });
  await page.waitForFunction(() => /Ship/.test(document.querySelector('[data-testid="show-stage"]').innerText));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="slideshow"]', { state: "detached" });
  log(`morph: ${morphing.length} objects moved from Build to Ship`);

  // .pptx: zooms are pictures of their slides that jump to them; morph is p159:morph
  const bytes = await page.evaluate(() => window.__exportPptxBytes());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const s2 = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.equal((s2.match(/action="ppaction:\/\/hlinksldjump"/g) || []).length, 2);
  const rels2 = await zip.file("ppt/slides/_rels/slide2.xml.rels").async("string");
  const pics = [...rels2.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => m[1]);
  const sizes = await Promise.all(pics.map(async (p) => (await zip.file(`ppt/media/${p}`).async("uint8array")).length));
  assert.ok(sizes.length >= 1 && sizes.every((n) => n > 2000), `zoom pictures are drawn slides: ${sizes}`);
  assert.match(await zip.file("ppt/slides/slide5.xml").async("string"), /<p159:morph option="byObject"\/>/);
  const custom = await zip.file("docProps/custom.xml").async("string");
  assert.match(custom, /name="SynergyZooms"/);
  writeFileSync(path.join(OUT, "zooms.pptx"), Buffer.from(bytes));
  log(`.pptx: two zoom pictures (${sizes.join(", ")} bytes) jump to their slides; Ship morphs`);

  // Record Slide Show: narration from the (fake) microphone on two slides
  await page.locator('[data-testid="slide-thumb"]').nth(0).click();
  page.on("dialog", (dlg) => dlg.accept());
  await menu("Slide Show", "Record slide show (narration and ink)…");
  await page.waitForSelector('[data-testid="record-state"][data-mic="on"]', { timeout: 15000 });
  await page.waitForTimeout(1600);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1600);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__slides().filter((s) => s.elements.some((e) => e.type === "media" && e.narration)).length === 2, null, { timeout: 30000 });
  page.removeAllListeners("dialog");
  d = await slides();
  const narr = d[0].elements.find((e) => e.narration);
  assert.equal(narr.kind, "audio");
  assert.equal(narr.autoplay, true);
  assert.ok(d[0].trans?.advAfter >= 1000, "the recorded time became the slide's timing");
  const dur = await page.evaluate(async (src) => {
    const r = await fetch(src);
    const buf = await r.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 48000);
    return (await ctx.decodeAudioData(buf)).duration;
  }, narr.src);
  assert.ok(dur > 1 && dur < 4, `narration of about 1.6 s: ${dur}`);
  log(`recorded narration on 2 slides (${dur.toFixed(2)} s on the first) and their timings`);

  // export to video
  const probe = (o) =>
    page.evaluate(async (opts) => {
      const r = await window.__exportVideo(opts);
      const v = document.createElement("video");
      v.muted = true;
      v.src = r.url;
      const duration = await new Promise((res) => {
        v.onloadedmetadata = () => {
          if (Number.isFinite(v.duration)) return res(v.duration);
          v.currentTime = 1e9;
          v.ontimeupdate = () => res(v.duration);
        };
        v.onerror = () => res(-1);
      });
      const bytes = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      const text = new TextDecoder("latin1").decode(bytes);
      return { ...r, duration, w: v.videoWidth, h: v.videoHeight, opus: text.includes("A_OPUS") || text.includes("Opus"), aac: text.includes("mp4a") };
    }, o);
  const webm = await probe({ format: "webm", height: 720, secs: 1, recorded: true, transitions: true });
  assert.equal(webm.type, "video/webm");
  assert.deepEqual(webm.head.slice(0, 4), [0x1a, 0x45, 0xdf, 0xa3]);
  assert.deepEqual([webm.w, webm.h], [1280, 720]);
  assert.ok(webm.opus, "the narration is the WebM's Opus sound track");
  // 5 slides: two narrated (their timings), three at 1 s, plus transitions
  assert.ok(webm.duration > 4 && webm.duration < 12, `duration ${webm.duration}`);
  const mp4 = await probe({ format: "mp4", height: 720, secs: 1, recorded: false, transitions: false });
  assert.equal(mp4.type, "video/mp4");
  assert.equal(String.fromCharCode(...mp4.head.slice(4, 8)), "ftyp");
  assert.ok(mp4.duration > 4 && mp4.duration < 6, `mp4 duration ${mp4.duration}`);
  log(`video: WebM ${webm.w}×${webm.h}, ${webm.duration.toFixed(1)} s, ${webm.size} bytes with sound; MP4 ${mp4.duration.toFixed(1)} s, ${mp4.size} bytes`);
  // and from the menu
  await menu("File", "Export as video (WebM, MP4)…");
  await page.waitForSelector('[data-testid="video-dialog"]');
  await page.locator('[data-testid="video-secs"]').fill("1");
  await page.waitForFunction(() => !document.querySelector('[data-testid="video-export"]')?.disabled);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.locator('[data-testid="video-export"]').click()]);
  assert.match(dl.suggestedFilename(), /\.(webm|mp4)$/);
  log(`downloaded ${dl.suggestedFilename()} from File > Export as video`);

  // Designer: built-in ideas for the Build slide, then one from the AI model
  await page.locator('[data-testid="slide-thumb"]').nth(3).click();
  await page.locator('[data-testid="tb-designer"]').click();
  await page.waitForSelector('[data-testid="designer-idea"]');
  const ideaIds = await page.locator('[data-testid="designer-idea"]').evaluateAll((l) => l.map((b) => b.dataset.idea));
  assert.ok(ideaIds.includes("band"), `ideas: ${ideaIds}`);
  const before = (await slides())[3];
  await page.locator('[data-testid="designer-idea"][data-idea="band"]').click();
  await page.waitForFunction((n) => window.__slides()[3].elements.length === n + 1 && window.__slides()[3].tstyle?.color === "FFFFFF", before.elements.length);
  log(`Designer: ${ideaIds.length} built-in ideas (${ideaIds.join(", ")}); applied Title band`);
  if (fakeAi) {
    await page.waitForSelector('[data-testid="designer-ai"]');
    await page.locator('[data-testid="designer-ai"]').click();
    await page.waitForSelector('[data-testid="designer-idea"][data-idea="ai-0"]');
    await page.screenshot({ path: path.join(OUT, "4-designer.png") });
    await page.locator('[data-testid="designer-idea"][data-idea="ai-0"]').click();
    await page.waitForFunction(() => window.__slides()[3].tbox?.x > 600);
    const sentSlide = JSON.parse(fakeAi.seen.at(-1).messages.at(-1).content);
    assert.equal(sentSlide.title.text, "Build");
    log("Designer: an AI idea (from the stand-in model) applied");
  } else {
    await page.waitForSelector('[data-testid="designer-no-ai"]');
    log("Designer: no AI model connected, the pane says so");
  }
  await page.locator('[data-testid="tb-designer"]').click();

  // new slides from an outline (and from the AI model)
  const n0 = (await slides()).length;
  await menu("File", "New slides from an outline or AI…");
  await page.waitForSelector('[data-testid="draft-dialog"]');
  await page.locator('[data-testid="draft-text"]').fill("Retro\nQ2 review\nWins\n  - Shipped zoom\n  - Video export\nNext\n  - Accessibility\n  Notes: ask for volunteers");
  await page.waitForFunction(() => /A title slide \(“Retro”\) and 2 slides/.test(document.querySelector('[data-testid="draft-summary"]').textContent));
  await page.locator('[data-testid="draft-create"]').click();
  await page.waitForFunction((n) => window.__slides().length === n + 3, n0);
  d = await slides();
  const at = d.findIndex((x) => x.title === "Retro");
  assert.deepEqual(d.slice(at, at + 3).map((x) => [x.layout, x.title]), [["title", "Retro"], ["content", "Wins"], ["content", "Next"]]);
  assert.equal(d[at + 2].notes, "ask for volunteers");
  log("drafted 3 slides from an outline");
  if (fakeAi) {
    await menu("File", "New slides from an outline or AI…");
    await page.locator('[data-testid="draft-ai"]').check();
    await page.locator('[data-testid="draft-text"]').fill("Expense policy for new staff");
    await page.locator('[data-testid="draft-create"]').click();
    await page.waitForFunction(() => window.__slides().some((x) => x.title === "What you can claim"));
    d = await slides();
    const k = d.findIndex((x) => x.title === "Expense policy");
    assert.deepEqual(d.slice(k, k + 4).map((x) => x.title), ["Expense policy", "What you can claim", "How to submit", "Deadlines"]);
    log("drafted 4 slides with the AI model");
  }

  // Review > Check accessibility: give the Agenda's zoom alternative text
  await menu("Review", "Check accessibility");
  await page.waitForSelector('[data-testid="a11y-list"]');
  const altIssues = await page.locator('[data-testid="a11y-issue"][data-kind="alt"]').count();
  assert.ok(altIssues >= 3, `zooms without alt text: ${altIssues}`);
  await page.locator('[data-testid="a11y-issue"][data-kind="alt"][data-slide="0"]').first().click();
  await page.locator('[data-testid="a11y-alt"]').fill("Zoom to the Build slide");
  await page.locator('[data-testid="a11y-alt-save"]').click();
  await page.waitForFunction(() => window.__slides()[0].elements.find((e) => e.type === "zoom").alt === "Zoom to the Build slide");
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="a11y-issue"][data-kind="alt"]').length === n - 1, altIssues);
  await page.screenshot({ path: path.join(OUT, "5-a11y.png") });
  log(`accessibility: ${altIssues} objects without alt text; one fixed from the pane`);

  // Review > Spelling: a misspelled word in the notes
  await page.locator('[data-testid="slide-thumb"]').nth(2).click();
  await page.locator('[data-testid="slide-notes"]').fill("Mention the recieved feedback");
  await page.waitForFunction(() => window.__slides()[2].notes === "Mention the recieved feedback");
  await page.locator('[data-testid="review-spell"]').click();
  await page.waitForSelector('[data-testid="spell-panel"]', { timeout: 30000 });
  const words = [];
  for (let k = 0; k < 20; k++) {
    const w = await page.locator('[data-testid="spell-word"]').innerText();
    words.push(w);
    if (w === "recieved") break;
    await page.locator('[data-testid="spell-ignore-all"]').click();
  }
  assert.equal(words.at(-1), "recieved", `words: ${words}`);
  await page.locator('[data-testid="spell-suggestions"] button', { hasText: /^received$/ }).click();
  await page.locator('[data-testid="spell-change"]').click();
  await page.waitForFunction(() => window.__slides()[2].notes === "Mention the received feedback");
  log(`spelling: changed “recieved” to “received” (ignored ${words.length - 1} other word(s): ${words.slice(0, -1).join(", ") || "none"})`);

  // Edit points: a rectangle becomes a freeform whose points can be dragged and added
  await page.locator('[data-testid="slide-thumb"]').nth(1).click();
  const n1 = await page.evaluate(() => window.__slides()[1].elements.length);
  await page.locator('[data-testid="tb-shapes"]').click();
  await page.locator('[data-testid="shape-rect"]').click();
  await page.waitForFunction((n) => window.__slides()[1].elements.length === n + 1, n1);
  const rectId = await page.evaluate(() => window.__slides()[1].elements.at(-1).id);
  await page.locator('[data-testid="tb-edit-points"]').click();
  await page.waitForSelector('[data-testid="point-editor"]');
  await page.waitForFunction((id) => window.__slides()[1].elements.find((e) => e.id === id).shape === "freeform", rectId);
  assert.equal(await page.locator('[data-testid="pt-anchor"]').count(), 4);
  const d0 = await page.evaluate((id) => window.__slides()[1].elements.find((e) => e.id === id).geom.d, rectId);
  const ab = await page.locator('[data-testid="pt-anchor"]').nth(2).boundingBox();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + 40, ab.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(([id, d]) => window.__slides()[1].elements.find((e) => e.id === id).geom.d !== d, [rectId, d0]);
  const sb = await page.locator('[data-testid="pt-seg"]').first().boundingBox();
  await page.locator('[data-testid="pt-seg"]').first().dblclick({ position: { x: sb.width / 2, y: Math.min(sb.height / 2, 3) }, force: true });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="pt-anchor"]').length === 5);
  await page.screenshot({ path: path.join(OUT, "6-points.png") });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-testid="point-editor"]'));
  log("edit points: rectangle turned freeform, a point dragged and one added");

  // WordArt and columns on the same shape
  await page.locator(`[data-el-id="${rectId}"]`).click({ force: true });
  await page.locator('[data-testid="tb-wordart"]').click();
  await page.locator('[data-testid="wordart-gold"]').click();
  await page.waitForFunction((id) => window.__slides()[1].elements.find((e) => e.id === id).wa?.grad?.stops.length === 3, rectId);
  await page.locator('[data-testid="tb-columns"]').click();
  await page.locator('[data-testid="cols-2"]').click();
  await page.waitForFunction((id) => window.__slides()[1].elements.find((e) => e.id === id).cols === 2, rectId);
  await page.keyboard.press("Escape");
  const fxBytes = await page.evaluate(() => window.__exportPptxBytes());
  const fxZip = await JSZip.loadAsync(Buffer.from(fxBytes));
  const s2xml = await fxZip.file("ppt/slides/slide2.xml").async("string");
  assert.match(s2xml, /<a:custGeom>/);
  assert.match(s2xml, /numCol="2"/);
  log("WordArt and two columns set; the .pptx has the freeform and numCol");

  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
  fakeAi?.server.close();
}
