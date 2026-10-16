// Browser check for Docs + .docx: open a rich Word file (written by
// python-docx: styles, lists, merged table, picture, link, comment, sections,
// headers/footers with page numbers), check the print layout, edit styles,
// page setup, headers/footers and add a table of contents, then save as
// .docx, read the file back in a new document and compare. When LibreOffice
// is installed the saved file is also converted to PDF to check it opens.
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-docx.e2e.mjs
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
const OUT = mkdtempSync(path.join(tmpdir(), "docs-e2e-"));
const here = path.dirname(new URL(import.meta.url).pathname);
const log = (...a) => console.log("•", ...a);

function inputDoc() {
  const file = path.join(OUT, "input.docx");
  try {
    execFileSync("python3", [path.join(here, "..", "fixtures", "make_python_docx.py"), file]);
  } catch {
    throw new Error("python-docx is required for the e2e input document (pip install python-docx)");
  }
  return file;
}

async function newDoc(page) {
  const r = await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } });
  const { id } = await r.json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__docsLayout === "function" && window.__docsLayout() !== null, null, { timeout: 60000 });
  return id;
}

const layout = (page) => page.evaluate(() => window.__docsLayout());
const pageCount = async (page) => (await layout(page)).pages.length;
const css = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

async function waitPages(page, test, what) {
  await page.waitForFunction((t) => {
    const l = window.__docsLayout();
    return !!l && new Function("l", `return ${t}`)(l);
  }, test, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`${what}: ${JSON.stringify(await layout(page))} (${e.message})`);
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
page.on("dialog", (d) => d.accept());
try {
  const file = inputDoc();
  log("input document written with python-docx");

  // 1) open the .docx from File > Open (the file input)
  await newDoc(page);
  await page.setInputFiles('[data-testid="docx-input"]', file);
  await page.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("Landscape section"), null, { timeout: 60000 });
  await waitPages(page, "l.pages.length === 3", "three pages");
  let l = await layout(page);
  assert.equal(Math.round(l.pages[0].width), 794, "A4 portrait width");
  assert.equal(Math.round(l.pages[2].width), 1122, "landscape section");
  assert.equal(l.pages[0].hf, "first");
  assert.equal(l.pages[2].section, 1);
  const headers = await page.locator('[data-testid="page-header"]').allInnerTexts();
  const footers = await page.locator('[data-testid="page-footer"]').allInnerTexts();
  assert.equal(headers[0].trim(), "Cover header");
  assert.equal(headers[1].trim(), "Running header");
  assert.equal(footers[1].trim(), "Page 2 of 3");
  assert.equal(footers[0].trim(), "", "first page has its own (empty) footer");
  log("print layout: 3 pages (A4, A4, A4 landscape), first-page header, Page X of Y footer");

  // styles, formatting, lists, table, picture, link, comment
  assert.equal(await page.locator(".ProseMirror p[data-style=Title]").innerText(), "Fixture Report");
  assert.match(await css(page, ".ProseMirror p[data-style=CalloutBox]", "fontFamily"), /Georgia/);
  assert.equal(await css(page, ".ProseMirror p[data-style=CalloutBox]", "color"), "rgb(51, 102, 153)");
  assert.equal(await css(page, ".ProseMirror p[data-style=CalloutBox]", "fontWeight"), "700");
  assert.equal(await css(page, ".ProseMirror h1", "color"), "rgb(54, 95, 145)");
  assert.equal(await css(page, '.ProseMirror span[data-cstyle="RedNote"]', "color"), "rgb(192, 0, 0)");
  assert.match(await css(page, '.ProseMirror span[style*="Arial"]', "fontSize"), /^18\.6/); // 14pt
  assert.equal(await page.locator(".ProseMirror ol li ol li").first().innerText(), "Detail under second");
  assert.equal(await page.locator(".ProseMirror td[colspan='2']").innerText(), "merged across");
  assert.equal(await page.locator(".ProseMirror td[rowspan='2']").innerText(), "merged down");
  assert.equal(await css(page, ".ProseMirror td[data-bg]", "backgroundColor"), "rgb(217, 226, 243)");
  assert.equal(await page.locator(".ProseMirror .word-image img").evaluate((i) => i.style.width), "192px");
  assert.equal(await page.locator(".ProseMirror a").first().getAttribute("href"), "https://example.org/docs");
  await page.waitForSelector("text=Please check this sentence.");
  assert.equal(await page.locator(".ProseMirror .comment-mark").innerText(), " commented text");
  await page.screenshot({ path: path.join(OUT, "1-opened.png") });
  log("styles, run formatting, nested lists, merged/shaded table, sized picture, link and comment came through");

  // 2) styles: modify a style, create one from the selection, apply from the gallery
  await page.locator('[data-testid="style-gallery"] button[title="Styles pane"]').click();
  await page.waitForSelector('[data-testid="styles-pane"]');
  await page.locator('[data-testid="styles-pane"] [data-pane-style="CalloutBox"]').hover();
  await page.locator('[data-modify-style="CalloutBox"]').click();
  await page.locator('input[aria-label="Style color"]').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "#c00000");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('input[aria-label="Style size"]').fill("15");
  await page.locator('[data-testid="style-save"]').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ProseMirror p[data-style=CalloutBox]")).color === "rgb(192, 0, 0)");
  assert.equal(await css(page, ".ProseMirror p[data-style=CalloutBox]", "fontSize"), "20px");
  // new paragraph style from the selection, then apply it to another paragraph
  await page.locator(".ProseMirror p", { hasText: "Text on the second page." }).click();
  await page.locator('[data-testid="new-style"]').click();
  await page.locator('input[aria-label="Style name"]').fill("Fine Print");
  await page.locator('input[aria-label="Style size"]').fill("8");
  await page.locator('input[aria-label="Style space after"]').fill("2");
  await page.locator('[data-testid="style-save"]').click();
  await page.waitForSelector(".ProseMirror p[data-style=FinePrint]");
  assert.equal(await css(page, ".ProseMirror p[data-style=FinePrint]", "fontSize"), "10.6667px");
  await page.locator(".ProseMirror h1", { hasText: "Landscape section" }).click();
  await page.locator('[data-testid="style-gallery"] [data-style-id="Heading2"]').click();
  await page.waitForSelector(".ProseMirror h2:has-text('Landscape section')");
  await page.locator('[data-testid="styles-pane"] button:has-text("✕")').first().click();
  log("styles: modified Callout Box, created Fine Print from the selection, applied Heading 2 from the gallery");

  // 3) page layout: narrow margins and two columns on the first section, a page break, typing past a page
  await page.locator(".ProseMirror p", { hasText: "Text on the second page." }).click();
  await page.getByText("Layout", { exact: true }).click();
  await page.getByText("Page setup…").click();
  await page.locator('input[aria-label="Margin left"]').fill("0.5");
  await page.locator('input[aria-label="Margin left"]').blur();
  await page.locator('input[aria-label="Margin right"]').fill("0.5");
  await page.locator('input[aria-label="Margin right"]').blur();
  await page.locator('[role=dialog] button:has-text("OK")').click();
  await page.waitForFunction(() => {
    const p = [...document.querySelectorAll(".ProseMirror > p")].find((x) => x.textContent === "Text on the second page.");
    return p && Math.abs(parseFloat(p.style.width) - (793.93 - 96)) < 2;
  });
  // a page break before "Lists" adds a page
  await page.locator(".ProseMirror h2", { hasText: "Lists" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Control+Enter");
  await waitPages(page, "l.pages.length === 4", "page break adds a page");
  // a long run of text flows onto new pages in the landscape section, in two columns
  await page.locator(".ProseMirror p", { hasText: "Column text paragraph 6." }).click();
  // let the relayout after the page break settle before typing
  await page.waitForFunction(() => window.__docsEditor?.state.selection.$from.parent.textContent.startsWith("Column text paragraph 6"));
  await page.waitForTimeout(300);
  await page.keyboard.press("End");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`Filler line ${i + 1} to fill the columns of this landscape page.`);
  }
  await waitPages(page, "l.pages.length >= 4 && l.pages[l.pages.length - 1].width > 1100", "typing stays in the landscape section");
  const colX = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror > p")].filter((p) => /Filler line/.test(p.textContent)).map((p) => Math.round(parseFloat(p.style.marginLeft))));
  assert.ok(new Set(colX).size >= 2, `filler text uses both columns: ${[...new Set(colX)]}`);
  await page.screenshot({ path: path.join(OUT, "2-layout.png") });
  log(`layout: margins applied to section 1, page break added a page, text flows into the second column (${await pageCount(page)} pages)`);

  // 4) headers and footers: edit the running header from the page, give section 2 its own footer
  const hdr = page.locator('[data-testid="page-header"]').nth(1);
  await hdr.dblclick();
  await page.waitForSelector('[data-testid="hf-editor"] .ProseMirror');
  await page.locator('[data-testid="hf-editor"] .ProseMirror').click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" (edited)");
  await page.locator('[role=dialog] button:has-text("Save")').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="page-header"]')].some((h) => h.innerText.trim() === "Running header (edited)"));
  // landscape section: own footer with the page number, odd/even on
  const lastFooter = page.locator('[data-testid="page-footer"]').last();
  await lastFooter.dblclick();
  await page.waitForSelector('[data-testid="hf-editor"] .ProseMirror');
  await page.locator('[role=dialog] label:has-text("Link to previous") input').uncheck();
  await page.locator('[data-testid="hf-editor"] .ProseMirror').click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Appendix page ");
  await page.locator('[data-testid="hf-page-number"]').click();
  await page.locator('[role=dialog] button:has-text("Save")').click();
  await page.waitForFunction(() => /Appendix page \d+/.test(document.querySelectorAll('[data-testid="page-footer"]')[document.querySelectorAll('[data-testid="page-footer"]').length - 1].innerText));
  const f2 = await page.locator('[data-testid="page-footer"]').allInnerTexts();
  const n = f2.length;
  assert.match(f2[1].trim(), new RegExp(`^Page 2 of ${n}$`));
  log(`headers/footers: edited the running header, section 2 footer "${f2[n - 1].trim()}"`);

  // 5) table of contents at the top
  await page.locator(".ProseMirror p[data-style=Title]").click();
  await page.keyboard.press("Home");
  await page.getByText("References", { exact: true }).click();
  await page.getByText("Table of contents", { exact: true }).click();
  await page.waitForSelector(".ProseMirror .word-toc .word-toc-entry");
  const toc = await page.locator(".ProseMirror .word-toc .word-toc-entry").allInnerTexts();
  assert.ok(toc.some((t) => /^Introduction\s*1$/.test(t.trim())), `TOC entries: ${toc}`);
  assert.ok(toc.some((t) => /^Second page\s*\d+$/.test(t.trim())));
  await page.screenshot({ path: path.join(OUT, "3-edited.png") });
  log(`table of contents: ${toc.length} entries with page numbers`);

  // 6) save as .docx and check the file
  const before = await page.evaluate(() => window.__docsState());
  const pagesBefore = await pageCount(page);
  const bytes = Buffer.from(await page.evaluate(() => window.__docsExportBytes()));
  const out = path.join(OUT, "saved.docx");
  writeFileSync(out, bytes);
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml").async("string");
  const stylesXml = await zip.file("word/styles.xml").async("string");
  assert.match(docXml, /TOC \\o "1-3" \\h \\z \\u/);
  assert.equal((docXml.match(/<w:sectPr>/g) || []).length, 2);
  assert.match(docXml, /<w:br w:type="page"\/>/);
  assert.match(docXml, /<w:cols w:num="2"/);
  assert.match(stylesXml, /w:styleId="CalloutBox"[\s\S]*?<w:color w:val="C00000"\/>/);
  assert.match(stylesXml, /w:styleId="FinePrint"/);
  const parts = Object.keys(zip.files);
  const hdrs = await Promise.all(parts.filter((p) => /^word\/(header|footer)\d+\.xml$/.test(p)).map((p) => zip.file(p).async("string")));
  assert.ok(hdrs.some((x) => x.includes("Running header (edited)")));
  assert.ok(hdrs.some((x) => x.includes("Appendix page") && x.includes("PAGE")));
  const comments = await zip.file("word/comments.xml").async("string");
  assert.match(comments, /Please check this sentence\./);
  log("saved .docx has the TOC field, 2 sections, page break, columns, styles, headers/footers and the comment");

  // 7) read it back in a new document and compare
  await newDoc(page);
  await page.setInputFiles('[data-testid="docx-input"]', out);
  await page.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("Filler line 30"), null, { timeout: 60000 });
  await waitPages(page, `l.pages.length === ${pagesBefore}`, "same page count after the round trip");
  const after = await page.evaluate(() => window.__docsState());
  const blocks = (j) => j.content.map((b) => `${b.type}${b.attrs?.level ? b.attrs.level : ""}${b.attrs?.styleId ? ":" + b.attrs.styleId : ""}`);
  assert.deepEqual(blocks(after.json), blocks(before.json));
  const styleOf = (st, id) => st.styles.find((s) => s.id === id);
  assert.equal(styleOf(after, "CalloutBox").run.color, "#c00000");
  assert.equal(styleOf(after, "CalloutBox").run.size, 15);
  assert.equal(styleOf(after, "FinePrint").run.size, 8);
  assert.equal(after.body.orientation, "landscape");
  assert.equal(after.body.columns.count, 2);
  const hdr2 = await page.locator('[data-testid="page-header"]').allInnerTexts();
  assert.ok(hdr2.includes("Running header (edited)"));
  const ftr2 = await page.locator('[data-testid="page-footer"]').allInnerTexts();
  assert.match(ftr2[ftr2.length - 1].trim(), /^Appendix page \d+$/);
  await page.waitForSelector("text=Please check this sentence.");
  assert.ok((await page.locator(".ProseMirror .word-toc-entry").count()) >= 4);
  await page.screenshot({ path: path.join(OUT, "4-reopened.png") });
  log("round trip: same blocks, styles, sections, headers/footers, comment and TOC");

  // 8) LibreOffice opens the file
  if (existsSync("/usr/bin/soffice") || existsSync("/usr/bin/libreoffice")) {
    const prof = mkdtempSync(path.join(tmpdir(), "lo-"));
    try {
      execFileSync("soffice", [`-env:UserInstallation=file://${prof}`, "--headless", "--convert-to", "pdf", "--outdir", OUT, out], { stdio: "ignore", timeout: 180000 });
    } finally {
      rmSync(prof, { recursive: true, force: true });
    }
    const info = execFileSync("pdfinfo", [path.join(OUT, "saved.pdf")]).toString();
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    assert.ok(pages >= 3, `LibreOffice renders ${pages} pages`);
    const text = execFileSync("pdftotext", [path.join(OUT, "saved.pdf"), "-"]).toString();
    for (const s of ["Fixture Report", "Running header (edited)", "Appendix page", "Filler line 30", "merged across"]) assert.ok(text.includes(s), `LibreOffice text has ${s}`);
    log(`LibreOffice opens the saved file: ${pages} pages`);
  } else log("LibreOffice not installed: skipped");

  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
