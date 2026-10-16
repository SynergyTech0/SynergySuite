// Browser check for the thesaurus, read aloud and the accessibility checker.
// Speech synthesis is replaced by a recorder so the test hears what is read.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-review-tools.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.addInitScript(() => {
  // a speech engine that "speaks" each utterance word by word, 40ms a word
  const spoken = [];
  window.__spoken = spoken;
  let timer = null;
  const fake = {
    speaking: false,
    paused: false,
    getVoices: () => [{ name: "Test Voice", lang: "en-US", default: true, localService: true, voiceURI: "test" }],
    addEventListener() {},
    removeEventListener() {},
    cancel() {
      clearTimeout(timer);
      this.speaking = false;
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    speak(u) {
      spoken.push(u.text);
      this.speaking = true;
      const words = [...u.text.matchAll(/\S+/g)];
      let i = 0;
      const step = () => {
        if (this.paused) return (timer = setTimeout(step, 40));
        if (i < words.length) {
          u.onboundary?.({ name: "word", charIndex: words[i].index, charLength: words[i][0].length });
          i++;
          timer = setTimeout(step, 40);
        } else {
          this.speaking = false;
          u.onend?.({});
        }
      };
      timer = setTimeout(step, 10);
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
  };
});
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const json = () => page.evaluate(() => window.__docsEditor.getJSON());
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Review" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Report" }] },
        { type: "paragraph", content: [{ type: "text", text: "We were happy with the results." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph here." }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Detail" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }, { type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] }] }] },
      ],
    }),
  );

  // thesaurus: the word at the cursor, replace it keeping its case
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes("happy")) at = pos + n.text.indexOf("happy") + 2;
    });
    ed.chain().focus().setTextSelection(at).run();
  });
  await page.keyboard.press("Shift+F7");
  await page.getByTestId("thesaurus-results").waitFor();
  assert.equal(await page.getByLabel("Thesaurus search").inputValue(), "happy");
  await page.locator('[data-synonym="blissful"]').hover();
  await page.locator('[data-insert="blissful"]').click();
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[1].content[0].text === "We were blissful with the results.");
  log("thesaurus replaced happy with blissful");

  // read aloud from the cursor: paragraph by paragraph, the spoken word highlighted
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(10).run());
  await menu("Review", "Read aloud");
  await page.getByTestId("read-aloud").waitFor();
  await page.waitForSelector(".ProseMirror .read-aloud-word");
  await page.waitForFunction(() => window.__spoken.includes("Second paragraph here."), null, { timeout: 15000 });
  const spoken = await page.evaluate(() => window.__spoken);
  assert.equal(spoken[0], "We were blissful with the results.");
  await page.getByTestId("read-aloud-stop").click();
  await page.waitForFunction(() => !document.querySelector(".ProseMirror .read-aloud-block"));
  log(`read aloud: ${spoken.length} paragraphs`);

  // accessibility: skipped heading and a table without a header row; fix them
  await menu("Review", "Check accessibility");
  await page.getByTestId("accessibility-pane").waitFor();
  await page.locator('[data-issue="tableNoHeader"] button').first().click();
  await page.getByTestId("a11y-fix").click();
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[4].content[0].content[0].type === "tableHeader");
  await page.locator('[data-issue="headingSkipped"] button').first().click();
  await page.getByTestId("a11y-fix").click();
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[3].attrs.level === 2);
  await page.waitForFunction(() => !document.querySelector('[data-issue="headingSkipped"]') && !document.querySelector('[data-issue="tableNoHeader"]'));
  log("accessibility issues found and fixed");
  console.log("docs review tools e2e: all checks passed");
} finally {
  await browser.close();
}
