// Browser check for the Docs AI tools (Tools menu): fix grammar replaces the
// current paragraph, rewrite works on a selection, summarise inserts a summary
// below, draft inserts headings and paragraphs.
//
// Needs the office app started with DOCS_AI_MODEL and DOCS_AI_BASE_URL pointing
// at an OpenAI-compatible endpoint (a stand-in that answers predictably is
// enough), a collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-ai.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const menu = async (top, item) => {
  await page.getByText(top, { exact: true }).first().click();
  await page.getByText(item, { exact: true }).first().click();
};
const blocks = () => page.evaluate(() => window.__docsEditor.getJSON().content.map((n) => [n.type, (n.content || []).map((c) => c.text || (c.content || []).map((d) => (d.content || []).map((e) => e.text).join("")).join("|")).join("")]));
const select = (from, to) => page.evaluate(([f, t]) => window.__docsEditor.chain().focus().setTextSelection({ from: f, to: t }).run(), [from, to]);
try {
  const r = await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } });
  const { id } = await r.json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  const status = await (await page.request.get(`${BASE}/api/docs/ai`)).json();
  assert.equal(status.configured, true, "start the app with DOCS_AI_MODEL / DOCS_AI_BASE_URL");
  await page.evaluate(() => window.__docsEditor.chain().focus().setContent("<p>teh cat sat on teh mat.</p><p>Second paragraph here.</p>").setTextSelection(3).run());

  // fix grammar: no selection, so the current paragraph
  await menu("Tools", "Fix grammar with AI…");
  assert.match(await page.getByTestId("ai-source").innerText(), /teh cat sat/);
  await page.getByTestId("ai-run").click();
  await page.getByTestId("ai-result").waitFor();
  assert.equal(await page.getByTestId("ai-result").innerText(), "The cat sat on the mat.");
  await page.getByTestId("ai-replace").click();
  await page.getByTestId("ai-result").waitFor({ state: "detached" });
  assert.deepEqual((await blocks()).slice(0, 2), [["paragraph", "The cat sat on the mat."], ["paragraph", "Second paragraph here."]]);
  log("fix grammar replaces the paragraph");

  // rewrite a selection inside a paragraph: stays inline
  const start = await page.evaluate(() => {
    let at = -1;
    window.__docsEditor.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes("Second")) at = pos;
    });
    return at;
  });
  await select(start, start + 6);
  await menu("Tools", "Rewrite with AI…");
  await page.getByTestId("ai-tone").selectOption("formal");
  await page.getByTestId("ai-run").click();
  await page.getByTestId("ai-result").waitFor();
  await page.getByTestId("ai-replace").click();
  await page.getByTestId("ai-result").waitFor({ state: "detached" });
  assert.deepEqual((await blocks())[1], ["paragraph", "REWRITTEN: Second paragraph here."]);
  log("rewrite replaces the selection inline");

  // summarise the whole document: inserted below the current block
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(window.__docsEditor.state.doc.content.size - 1).run());
  await menu("Tools", "Summarise with AI…");
  assert.match(await page.getByTestId("ai-source").innerText(), /The cat sat[\s\S]*REWRITTEN/);
  await page.getByTestId("ai-run").click();
  await page.getByTestId("ai-insert").click();
  await page.getByTestId("ai-insert").waitFor({ state: "detached" });
  const b = await blocks();
  assert.deepEqual(b.slice(2, 4), [["paragraph", "Short summary."], ["bulletList", "Point onePoint two"]]);
  const bold = await page.evaluate(() => !!document.querySelector(".ProseMirror ul strong"));
  assert.ok(bold, "bold in the list");
  log("summarise inserts a paragraph and a list below");

  // draft from a prompt
  await menu("Tools", "Draft with AI…");
  assert.equal(await page.getByTestId("ai-run").isDisabled(), true);
  await page.getByTestId("ai-prompt").fill("an introduction");
  await page.getByTestId("ai-run").click();
  await page.getByTestId("ai-insert").click();
  await page.getByTestId("ai-insert").waitFor({ state: "detached" });
  const after = await blocks();
  assert.ok(after.some(([t, s]) => t === "heading" && s === "Drafted heading"), JSON.stringify(after));
  assert.ok(after.some(([t, s]) => t === "paragraph" && s === "Drafted paragraph."));
  log("draft inserts a heading and a paragraph");
  console.log("docs AI e2e: all checks passed");
} finally {
  await browser.close();
}
