// Browser check for Docs milestone 3 formatting: the Font dialog (small caps,
// character spacing), borders and shading, tab stops with a right-aligned
// dotted leader, drop caps, change case and the format painter.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-format.e2e.mjs
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
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const select = (text, from = 0, len) =>
  page.evaluate(([t, f, l]) => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t);
    });
    ed.chain().focus().setTextSelection({ from: at + f, to: at + f + (l ?? t.length) }).run();
  }, [text, from, len]);
const json = () => page.evaluate(() => window.__docsEditor.getJSON());
const closed = (testid) => page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"]`), testid);
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Heading words here" }] },
        { type: "paragraph", content: [{ type: "text", text: "Chapter one\t12" }] },
        { type: "paragraph", content: [{ type: "text", text: "Once upon a time there was a long paragraph that wraps over several lines so that the drop cap has room to sit beside it, which is what Word does." }] },
        { type: "paragraph", content: [{ type: "text", text: "the lower case sentence. another one." }] },
        { type: "paragraph", content: [{ type: "text", text: "Plain target text" }] },
      ],
    }),
  );

  // Font dialog: small caps and expanded spacing
  await select("Heading words");
  await menu("Format", "Font…");
  await page.getByLabel("Small caps").check();
  await page.getByLabel("Character spacing").selectOption("expanded");
  await page.getByLabel("Spacing by").fill("2");
  await page.getByTestId("font-ok").click();
  await closed("font-ok");
  const ts = (await json()).content[0].content[0].marks.find((m) => m.type === "textStyle").attrs;
  assert.equal(ts.smallCaps, true);
  assert.equal(ts.charSpacing, 2);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".ProseMirror [data-small-caps]")).fontVariantCaps), "small-caps");
  log("font dialog: small caps and character spacing");

  // borders and shading
  await select("Heading words");
  await menu("Format", "Borders and shading…");
  await page.getByTestId("borders-box").click();
  await page.getByLabel("No shading").uncheck();
  await page.getByTestId("borders-ok").click();
  await closed("borders-ok");
  const p0 = (await json()).content[0].attrs;
  assert.deepEqual(Object.keys(p0.borders).sort(), ["bottom", "left", "right", "top"]);
  assert.equal(p0.shading, "#f2f2f2");
  const bt = await page.evaluate(() => getComputedStyle(document.querySelector(".ProseMirror p[data-borders]")).borderTopStyle);
  assert.equal(bt, "solid");
  log("borders and shading");

  // tab stops: a right tab at 432pt with dots puts "12" at the right edge
  await select("Chapter one");
  await menu("Format", "Tabs…");
  await page.getByLabel("Tab stop position").fill("432");
  await page.getByLabel("Tab alignment").selectOption("right");
  await page.getByLabel("Tab leader").selectOption("dot");
  await page.getByTestId("tab-set").click();
  await page.getByTestId("tabs-ok").click();
  await closed("tabs-ok");
  await page.waitForFunction(() => {
    const t = document.querySelector(".ProseMirror .word-tab-dot");
    return t && t.getBoundingClientRect().width > 200;
  }, null, { timeout: 10000 });
  const geo = await page.evaluate(() => {
    const tab = document.querySelector(".ProseMirror .word-tab-dot");
    const p = tab.closest("p");
    const r = document.createRange();
    r.selectNodeContents(p);
    const rects = [...r.getClientRects()];
    const right = Math.max(...rects.map((x) => x.right));
    const scale = p.getBoundingClientRect().width / p.offsetWidth;
    return { end: (right - p.getBoundingClientRect().left) / scale, tab: tab.getBoundingClientRect().width / scale, html: p.innerHTML.slice(0, 300) };
  });
  assert.ok(Math.abs(geo.end - 432 * (4 / 3)) < 6, `right tab ends at the stop: ${JSON.stringify(geo)}`);
  log("right tab stop with a dot leader:", Math.round(geo.end), "px");

  // drop cap
  await select("Once upon");
  await menu("Insert", "Drop cap…");
  await page.getByTestId("dropcap-drop").click();
  await page.getByTestId("dropcap-ok").click();
  await closed("dropcap-ok");
  assert.equal((await json()).content[2].attrs.dropCap, "drop:3");
  const fl = await page.evaluate(() => getComputedStyle(document.querySelector(".ProseMirror p[data-dropcap]"), "::first-letter").float);
  assert.equal(fl, "left");
  log("drop cap");

  // change case
  await select("the lower case sentence. another one.");
  await menu("Format", "Change case", "Sentence case.");
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[3].content[0].text === "The lower case sentence. Another one.");
  await page.keyboard.press("Shift+F3");
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[3].content[0].text === "the lower case sentence. another one.");
  log("change case and Shift+F3");

  // format painter: bold red text onto the target
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes("Chapter")) at = pos;
    });
    ed.chain().setTextSelection({ from: at, to: at + 7 }).setBold().setColor("#c00000").run();
  });
  await select("Chapter", 1, 3);
  await page.getByTestId("format-painter").click();
  const tgt = await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes("target")) at = pos + n.text.indexOf("target");
    });
    const a = ed.view.coordsAtPos(at);
    const b = ed.view.coordsAtPos(at + 6);
    return { a, b };
  });
  await page.mouse.move(tgt.a.left + 1, (tgt.a.top + tgt.a.bottom) / 2);
  await page.mouse.down();
  await page.mouse.move(tgt.b.left - 1, (tgt.b.top + tgt.b.bottom) / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const p = window.__docsEditor.getJSON().content[4];
    return p.content.some((c) => c.text.includes("target") && c.marks?.some((m) => m.type === "bold"));
  });
  const painted = (await json()).content[4].content.find((c) => c.text.includes("target"));
  assert.equal(painted.marks.find((m) => m.type === "textStyle").attrs.color, "#c00000");
  assert.equal(await page.evaluate(() => !!document.querySelector(".ProseMirror.fmt-painter")), false, "the painter turns off after one use");
  log("format painter");

  // bullets and numbering: continue numbering from the list before, then a) b) c)
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    const li = (t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    ed.chain().insertContentAt(ed.state.doc.content.size, [
      { type: "orderedList", content: [li("first"), li("second")] },
      { type: "paragraph", content: [{ type: "text", text: "between" }] },
      { type: "orderedList", content: [li("third"), li("fourth")] },
    ]).run();
  });
  await select("third");
  await menu("Format", "Bullets and numbering", "Continue numbering");
  await page.waitForFunction(() => window.__docsEditor.getJSON().content.filter((n) => n.type === "orderedList")[1].attrs.start === 3);
  await menu("Format", "Bullets and numbering", "Numbering", "a) b) c)");
  await page.waitForFunction(() => {
    const a = window.__docsEditor.getJSON().content.filter((n) => n.type === "orderedList")[1].attrs;
    return a.numFmt === "lowerLetter" && a.lvlText === "%1)";
  });
  log("continue numbering and a) b) c)");

  // all of it in the .docx
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const xml = await (await JSZip.loadAsync(Buffer.from(bytes))).file("word/document.xml").async("string");
  for (const re of [/<w:smallCaps\/>/, /<w:pBdr>/, /<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"\/>/, /<w:tab w:val="right" w:leader="dot" w:pos="8640"\/>/, /w:dropCap="drop"/]) assert.match(xml, re);
  const numbering = await (await JSZip.loadAsync(Buffer.from(bytes))).file("word/numbering.xml").async("string");
  assert.match(numbering, /<w:start w:val="3"\/><w:numFmt w:val="lowerLetter"\/><w:lvlText w:val="%1\)"\/>/);
  log("saved in the .docx");
  console.log("docs format e2e: all checks passed");
} finally {
  await browser.close();
}
