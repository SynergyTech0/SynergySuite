// Browser check for Docs milestone 2 references: captions numbered with SEQ
// fields, cross-references (text, number, page, above/below), bookmarks, a
// table of figures, equations, citations and a bibliography, and their .docx
// round trip (checked in LibreOffice when
// it is installed).
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-refs.e2e.mjs
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
const OUT = mkdtempSync(path.join(tmpdir(), "docs-e2e3-"));
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
page.on("dialog", (d) => d.accept());
try {
  await newDoc(page);
  await page.evaluate(() => {
    const p = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const cell = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [p(t)] });
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Introduction" }] },
        p("Intro text."),
        p("Chart goes here."),
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Results" }] },
        { type: "table", content: [{ type: "tableRow", content: [cell("Cost"), cell("Amount")] }, { type: "tableRow", content: [cell("Rent"), cell("100")] }] },
        p("Results text."),
      ],
    });
  });

  // 1) captions: a figure below a paragraph, a table caption above a table, then one before both (renumbers)
  await clickEnd(page, "Chart goes here.");
  await menu(page, "References", "Insert caption…");
  await page.locator('[data-testid="caption-text"]').fill("Revenue by year");
  assert.equal(await page.locator('[data-testid="caption-preview"]').innerText(), "Figure 1: Revenue by year");
  await confirm(page, "caption-insert");
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(1).run());
  await page.locator(".ProseMirror td p", { hasText: "Rent" }).click();
  await menu(page, "References", "Insert caption…");
  assert.equal(await page.locator('[data-testid="caption-label"]').inputValue(), "Table");
  assert.equal(await page.locator('[data-testid="caption-position"]').inputValue(), "above");
  await page.locator('[data-testid="caption-text"]').fill("Costs");
  await confirm(page, "caption-insert");
  await clickEnd(page, "Intro text.");
  await menu(page, "References", "Insert caption…");
  await page.locator('[data-testid="caption-text"]').fill("Early chart");
  await confirm(page, "caption-insert");
  await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror p[data-style="Caption"]')].map((p) => p.textContent).join("|") === "Figure 1: Early chart|Figure 2: Revenue by year|Table 1: Costs");
  const tablePrev = await page.evaluate(() => document.querySelector(".ProseMirror .tableWrapper, .ProseMirror table").previousElementSibling?.textContent);
  assert.equal(tablePrev, "Table 1: Costs");
  log("captions: Figure 1, Figure 2 (renumbered when one was added before it), Table 1 above its table");

  // 2) cross-references to a caption, a heading's page and a bookmark
  await clickEnd(page, "Results text.");
  await page.keyboard.type(" See ");
  await menu(page, "References", "Cross-reference…");
  await page.locator('[data-testid="xref-type"]').selectOption("Figure");
  await page.locator('[data-testid="xref-item"]').nth(1).click();
  await page.locator('[data-testid="xref-show"]').selectOption("text");
  await confirm(page, "xref-insert");
  await page.keyboard.type(", shown ");
  await menu(page, "References", "Cross-reference…");
  await page.locator('[data-testid="xref-type"]').selectOption("Figure");
  await page.locator('[data-testid="xref-item"]').nth(1).click();
  await page.locator('[data-testid="xref-show"]').selectOption("above");
  await confirm(page, "xref-insert");
  await page.keyboard.type(", and the introduction on page ");
  await menu(page, "References", "Cross-reference…");
  await page.locator('[data-testid="xref-item"]').first().click();
  await page.locator('[data-testid="xref-show"]').selectOption("page");
  await confirm(page, "xref-insert");
  await page.keyboard.type(".");
  await clickEnd(page, "Intro text.");
  await page.keyboard.press("Home");
  await menu(page, "Insert", "Bookmark…");
  await page.getByLabel("Bookmark name").fill("Key point");
  await confirm(page, "bookmark-add");
  await clickEnd(page, "Results text.");
  await page.keyboard.type(" Recall: ");
  await menu(page, "References", "Cross-reference…");
  await page.locator('[data-testid="xref-type"]').selectOption("Bookmark");
  assert.deepEqual(await textOf(page, '[data-testid="xref-item"]'), ["Key_point"]);
  await page.locator('[data-testid="xref-item"]').first().click();
  await confirm(page, "xref-insert");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror p")].some((p) => p.textContent === "Results text. See Figure 2, shown above, and the introduction on page 1. Recall: Intro text."));
  log('cross-references: "Figure 2", "above", page "1" and a bookmark\'s text');

  // live update: a new figure before the referenced one renumbers the reference
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(1).run());
  await page.keyboard.press("End");
  await menu(page, "References", "Insert caption…");
  await page.locator('[data-testid="caption-text"]').fill("Cover image");
  await confirm(page, "caption-insert");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror p")].some((p) => p.textContent.includes("See Figure 3, shown above")));
  // Ctrl+click follows the reference
  await page.evaluate(() => window.__docsEditor.chain().setTextSelection(1).run());
  await page.locator(".ProseMirror .word-xref").first().click({ modifiers: ["Control"] });
  assert.equal(await page.evaluate(() => { const ed = window.__docsEditor; const n = ed.view.domAtPos(ed.state.selection.from).node; return (n.nodeType === 3 ? n.parentElement : n).closest("p").textContent; }), "Figure 3: Revenue by year");
  log("references renumber live (Figure 2 became Figure 3) and Ctrl+click jumps to the caption");

  // 3) table of figures
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(1).run());
  await menu(page, "References", "Insert table of figures");
  await page.waitForFunction(() => document.querySelectorAll('.word-toc[data-caption="Figure"] .word-toc-entry').length === 3);
  assert.deepEqual(await textOf(page, '.word-toc[data-caption="Figure"] .word-toc-entry > span:first-child'), ["Figure 1: Cover image", "Figure 2: Early chart", "Figure 3: Revenue by year"]);
  await page.screenshot({ path: path.join(OUT, "1-refs.png") });
  log("table of figures lists the 3 figure captions");

  // 4) .docx: SEQ, REF, PAGEREF fields, the bookmarks and the table of figures, and back
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const file = path.join(OUT, "refs.docx");
  writeFileSync(file, Buffer.from(bytes));
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml").async("string");
  assert.equal((xml.match(/SEQ Figure \\\* ARABIC/g) || []).length, 3);
  assert.match(xml, /SEQ Table/);
  assert.match(xml, /<w:bookmarkStart w:id="\d+" w:name="Key_point"\/>/);
  assert.match(xml, / REF _Ref\d+ \\h <\/w:instrText>.*?<w:t xml:space="preserve">Figure 3<\/w:t>/);
  assert.match(xml, / REF _Ref\d+ \\p \\h /);
  assert.match(xml, / PAGEREF _Ref\d+ \\h /);
  assert.match(xml, /TOC \\h \\z \\c "Figure"/);
  log("saved .docx has SEQ/REF/PAGEREF fields, the bookmarks and a TOC \\c table of figures");

  await newDoc(page);
  await page.evaluate((b) => window.__docsOpenBytes(b), bytes);
  await page.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("Results text."), null, { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror p")].some((p) => p.textContent === "Results text. See Figure 3, shown above, and the introduction on page 1. Recall: Intro text."), null, { timeout: 20000 });
  assert.deepEqual(await textOf(page, '.ProseMirror p[data-style="Caption"]'), ["Figure 1: Cover image", "Figure 2: Early chart", "Figure 3: Revenue by year", "Table 1: Costs"]);
  assert.equal(await page.locator('.word-toc[data-caption="Figure"] .word-toc-entry').count(), 3);
  log("round trip: captions, references and the table of figures came back live");

  // 5) equations: a display equation from Alt+= on an empty line, an inline one from the menu
  await clickEnd(page, "Chart goes here.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Alt+=");
  await page.locator('[data-testid="eq-preset"]').selectOption({ label: "Quadratic formula" });
  assert.equal(await page.locator('[data-testid="eq-display"]').isChecked(), true);
  await page.waitForSelector('[data-testid="eq-preview"] math mfrac');
  await confirm(page, "eq-apply");
  await page.waitForSelector(".ProseMirror .word-eq-display math mfrac");
  await clickEnd(page, "Chart goes here.");
  await page.keyboard.type(" Energy: ");
  await menu(page, "Insert", "Equation…");
  assert.equal(await page.locator('[data-testid="eq-display"]').isChecked(), false);
  await page.locator('[data-testid="eq-latex"]').fill("E=mc^{2}");
  await confirm(page, "eq-apply");
  await page.waitForSelector(".ProseMirror .word-eq:not(.word-eq-display) math msup");
  const eqBox = await page.locator(".ProseMirror .word-eq-display").boundingBox();
  const pBox = await page.locator(".ProseMirror p", { hasText: "Chart goes here." }).boundingBox();
  assert.ok(Math.abs(eqBox.x + eqBox.width / 2 - (pBox.x + pBox.width / 2)) < 4, "the display equation is centred");
  // double-click edits it
  await page.locator(".ProseMirror .word-eq:not(.word-eq-display)").dblclick();
  assert.equal(await page.locator('[data-testid="eq-latex"]').inputValue(), "E=mc^{2}");
  await page.locator('[data-testid="eq-latex"]').fill("E=mc^{3}");
  await confirm(page, "eq-apply");
  await page.waitForFunction(() => document.querySelector(".ProseMirror .word-eq:not(.word-eq-display)")?.getAttribute("data-latex") === "E=mc^{3}");
  log("equations: a centred display equation (Alt+=) and an inline one, edited by double-click");

  // 6) citations: add sources in the dialog, cite, switch style, bibliography
  await clickEnd(page, "Intro text.");
  await page.keyboard.type(" Water is scarce ");
  await menu(page, "References", "Insert citation…");
  // no sources yet: the dialog opens on the new-source form
  await page.locator('[data-testid="source-authors"]').fill("Smith, Jane");
  await page.locator('[data-testid="source-title"]').fill("Field Notes");
  await page.locator('[data-testid="source-year"]').fill("2020");
  await page.locator('[data-testid="source-publisher"]').fill("North Press");
  assert.equal(await page.locator('[data-testid="source-tag"]').inputValue(), "Smi20");
  await page.locator('[data-testid="source-save"]').click();
  await page.locator('[data-testid="cite-pages"]').fill("12");
  assert.equal(await page.locator('[data-testid="cite-preview"]').innerText(), "(Smith, 2020, p. 12)");
  await confirm(page, "cite-insert");
  await page.keyboard.type(" and soil too ");
  await menu(page, "References", "Insert citation…");
  await page.locator('[data-testid="source-new"]').click();
  await page.locator('[data-testid="source-type"]').selectOption("JournalArticle");
  await page.locator('[data-testid="source-authors"]').fill("Doe, John; Roe, Rita");
  await page.locator('[data-testid="source-title"]').fill("Soil and water");
  await page.locator('[data-testid="source-year"]').fill("2019");
  await page.locator('[data-testid="source-journal"]').fill("Earth Journal");
  await page.locator('[data-testid="source-volume"]').fill("12");
  await page.locator('[data-testid="source-save"]').click();
  await confirm(page, "cite-insert");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-cite")].map((e) => e.textContent).join("|") === "(Smith, 2020, p. 12)|(Doe & Roe, 2019)");
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(window.__docsEditor.state.doc.content.size - 1).run());
  await menu(page, "References", "Insert bibliography");
  await page.waitForFunction(() => document.querySelectorAll(".word-bib-entry").length === 2);
  assert.deepEqual(await textOf(page, ".word-bib-entry"), ["Doe, J., & Roe, R. (2019). Soil and water. Earth Journal, 12.", "Smith, J. (2020). Field Notes. North Press."]);
  assert.equal(await page.locator(".word-bib-title").innerText(), "References");
  await menu(page, "References", "Citation style: IEEE");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-cite")].map((e) => e.textContent).join("|") === "[1, p. 12]|[2]");
  assert.match((await textOf(page, ".word-bib-entry"))[0], /^\[1\]\s*J\. Smith, Field Notes\. North Press, 2020\.$/);
  await menu(page, "References", "Citation style: APA (7th edition)");
  await page.waitForFunction(() => document.querySelector(".ProseMirror .word-cite")?.textContent === "(Smith, 2020, p. 12)");
  await page.screenshot({ path: path.join(OUT, "2-citations.png"), fullPage: true });
  log("citations: two sources added from the dialog, APA (Smith, 2020, p. 12) and IEEE [1, p. 12], bibliography follows the style");

  const bytes2 = await page.evaluate(() => window.__docsExportBytes());
  const file2 = path.join(OUT, "cites.docx");
  writeFileSync(file2, Buffer.from(bytes2));
  const zip2 = await JSZip.loadAsync(Buffer.from(bytes2));
  const xml2 = await zip2.file("word/document.xml").async("string");
  assert.match(xml2, / CITATION Smi20 \\l 1033 \\p 12 <\/w:instrText>/);
  assert.match(xml2, /<w:docPartGallery w:val="Bibliographies"\/>/);
  assert.match(await zip2.file("customXml/item1.xml").async("string"), /<b:Tag>Doe19<\/b:Tag>/);
  assert.match(xml2, /<m:oMathPara>/);
  assert.match(xml2, /<m:oMath><m:sSup>|<m:oMath><m:r>.*?<m:sSup>/);
  await newDoc(page);
  await page.evaluate((b) => window.__docsOpenBytes(b), bytes2);
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-cite")].map((e) => e.textContent).join("|") === "(Smith, 2020, p. 12)|(Doe & Roe, 2019)", null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll(".word-bib-entry").length === 2);
  await page.waitForSelector(".ProseMirror .word-eq-display math mfrac");
  await page.waitForSelector(".ProseMirror .word-eq:not(.word-eq-display) math msup");
  log("round trip: equations (OMML), CITATION/BIBLIOGRAPHY fields and the customXml sources came back");

  if (existsSync("/usr/bin/soffice") || existsSync("/usr/bin/libreoffice")) {
    const prof = mkdtempSync(path.join(tmpdir(), "lo-"));
    try {
      execFileSync("soffice", [`-env:UserInstallation=file://${prof}`, "--headless", "--convert-to", "pdf", "--outdir", OUT, file, file2], { stdio: "ignore", timeout: 180000 });
    } finally {
      rmSync(prof, { recursive: true, force: true });
    }
    const text = execFileSync("pdftotext", [path.join(OUT, "refs.pdf"), "-"]).toString().replace(/\s+/g, " ");
    for (const s of ["Figure 3: Revenue by year", "Table 1: Costs", "See Figure 3", "Recall: Intro text."]) assert.ok(text.includes(s), `LibreOffice text has ${s}: ${text}`);
    const text2 = execFileSync("pdftotext", [path.join(OUT, "cites.pdf"), "-"]).toString().replace(/\s+/g, " ");
    for (const s of ["(Smith, 2020, p. 12)", "References", "Smith, J. (2020). Field Notes. North Press."]) assert.ok(text2.includes(s), `LibreOffice text has ${s}: ${text2}`);
    log("LibreOffice shows the captions, the cross-reference text, the citations and the bibliography");
  }
  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
