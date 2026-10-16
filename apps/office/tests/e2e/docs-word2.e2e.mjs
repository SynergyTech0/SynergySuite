// Browser check for Docs milestone 2: paragraphs and table rows split across
// pages (with the header row repeated), footnotes at the foot of the page and
// endnotes at the end, track changes in Suggesting mode with the Changes
// pane, and the .docx round trip of all of it (checked in LibreOffice when it
// is installed).
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-word2.e2e.mjs
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
const OUT = mkdtempSync(path.join(tmpdir(), "docs-e2e2-"));
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

/** Text lines that sit in a page's bottom margin, in the gap between pages or under the footnotes. */
async function strayLines(page) {
  return page.evaluate(() => {
    const l = window.__docsLayout();
    const root = document.querySelector(".ProseMirror.pl-root");
    const rr = root.getBoundingClientRect();
    const scale = rr.width / root.offsetWidth;
    const bad = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim() || t.parentElement.closest("[data-pl-gap], .pl-endnotes")) continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        const top = (r.top - rr.top) / scale;
        const bottom = (r.bottom - rr.top) / scale;
        const p = l.pages.find((pg) => top >= pg.top - 1 && top < pg.top + pg.height + 24);
        if (!p) continue;
        const foot = document.querySelectorAll('[data-testid="page-footnotes"]');
        let limit = p.top + p.height - 96;
        for (const f of foot) {
          const fr = f.getBoundingClientRect();
          const ft = (fr.top - rr.top) / scale;
          if (ft > p.top && ft < p.top + p.height) limit = Math.min(limit, ft);
        }
        if (bottom > limit + 2) bad.push({ text: t.nodeValue.slice(0, 20), bottom, limit, page: l.pages.indexOf(p) });
      }
    }
    return bad;
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.error("console:", m.text().slice(0, 300)));
page.on("dialog", (d) => d.accept());
try {
  await newDoc(page);
  // 1) long paragraphs and a long table with a header row
  await page.evaluate(() => {
    const words = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
    const para = (i) => ({ type: "paragraph", content: [{ type: "text", text: `Paragraph ${i}. ` + words.repeat(14) }] });
    const cell = (t, type = "tableCell") => ({ type, attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    const rows = [{ type: "tableRow", content: [cell("Item", "tableHeader"), cell("Amount", "tableHeader")] }];
    for (let r = 1; r <= 45; r++) rows.push({ type: "tableRow", content: [cell(`Row ${r}`), cell(String(r * 10))] });
    window.__docsEditor.commands.setContent({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Report" }] }, para(1), para(2), para(3), para(4), { type: "table", content: rows }, { type: "paragraph", content: [{ type: "text", text: "The end." }] }] });
  });
  await waitLayout(page, "l.splits.some((s) => s.kind === 'line') && l.splits.some((s) => s.kind === 'row')", "paragraph and table splits");
  await settle(page);
  let l = await layout(page);
  assert.ok(await page.locator(".ProseMirror .pl-gap").count() >= 1, "a gap widget inside a paragraph");
  assert.ok(await page.locator(".ProseMirror tr.pl-repeat-header").count() >= 1, "the header row repeats");
  assert.equal(await page.locator(".ProseMirror tr.pl-repeat-header").first().innerText().then((t) => t.replace(/\s+/g, " ").trim()), "Item Amount");
  assert.deepEqual(await strayLines(page), [], "no text in a bottom margin or between pages");
  const pagesBefore = l.pages.length;
  await page.screenshot({ path: path.join(OUT, "1-split.png") });
  log(`split across pages: ${l.splits.length} splits over ${pagesBefore} pages, table header repeated, no text in the margins`);

  // 2) a footnote from the keyboard and an endnote
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(20).run());
  await page.keyboard.press("Control+Alt+f");
  await page.waitForSelector('[data-testid="note-editor"] .ProseMirror');
  await page.locator('[data-testid="note-editor"] .ProseMirror').click();
  await page.keyboard.type("A footnote at the foot of the page.");
  await page.locator('[data-testid="note-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="page-footnotes"]')?.textContent?.includes("A footnote at the foot"), null, { timeout: 20000 });
  assert.equal(await page.locator(".ProseMirror sup.note-ref").first().evaluate((el) => getComputedStyle(el, "::after").content), "counter(fn)");
  assert.equal(await page.locator('[data-testid="page-footnotes"] .pl-note-num').first().innerText(), "1");
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    const end = ed.state.doc.content.size - 1;
    ed.chain().setTextSelection(end).insertNote("endnote", { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "An endnote after the text." }] }] }).run();
  });
  await page.waitForFunction(() => document.querySelector(".pl-endnotes")?.textContent?.includes("An endnote after the text."), null, { timeout: 20000 });
  await settle(page);
  assert.deepEqual(await strayLines(page), [], "text stays above the footnotes");
  l = await layout(page);
  assert.ok(l.pages[0].notes.length === 1, "the footnote is on page 1");
  await page.screenshot({ path: path.join(OUT, "2-notes.png") });
  log("footnote at the foot of page 1 (numbered 1), endnote after the last block");

  // 3) Suggesting mode: typing and deleting become tracked changes
  await page.locator('[data-testid="mode-select"]').selectOption("suggesting");
  await page.waitForSelector('[data-testid="tracking-badge"]');
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(1).run());
  await page.keyboard.type("Annual ");
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes("Paragraph 2.")) at = pos + n.text.indexOf("Paragraph 2.");
    });
    ed.chain().focus().setTextSelection({ from: at, to: at + 9 }).run();
  });
  await page.keyboard.press("Delete");
  assert.equal(await page.locator(".ProseMirror ins.tc-ins").first().innerText(), "Annual ");
  assert.equal(await page.locator(".ProseMirror del.tc-del").first().innerText(), "Paragraph");
  assert.match(await page.locator("h1").innerText(), /^Annual Report/);
  await page.locator('[data-testid="tracking-badge"]').click();
  await page.waitForSelector('[data-testid="changes-pane"]');
  assert.equal(await page.locator('[data-testid="change-item"]').count(), 2);
  log("Suggesting mode: insertion underlined, deletion struck through, both listed in the Changes pane");

  // 4) save as .docx: notes, tracked changes, splits do not leak into the file
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const file = path.join(OUT, "saved.docx");
  writeFileSync(file, Buffer.from(bytes));
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /<w:ins w:id="\d+" w:author="[^"]+" w:date="[^"]+"><w:r><w:t xml:space="preserve">Annual <\/w:t><\/w:r><\/w:ins>/);
  assert.match(xml, /<w:del [^>]*><w:r><w:delText>Paragraph<\/w:delText><\/w:r><\/w:del>/);
  assert.match(xml, /<w:footnoteReference w:id="1"\/>/);
  assert.match(xml, /<w:endnoteReference w:id="1"\/>/);
  assert.match(await zip.file("word/footnotes.xml").async("string"), /A footnote at the foot of the page\./);
  assert.match(xml, /<w:tblHeader\/>/);
  log("saved .docx has w:ins/w:del, the footnote and endnote parts and the repeating header row");

  // accept one change from the pane, reject the other
  await page.locator('[data-testid="change-item"][data-kind="insertion"] [data-testid="accept-change"]').click();
  await page.locator('[data-testid="change-item"][data-kind="deletion"] [data-testid="reject-change"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="change-item"]').length === 0);
  assert.equal(await page.locator(".ProseMirror ins, .ProseMirror del").count(), 0);
  assert.match(await page.locator(".ProseMirror p", { hasText: "Paragraph 2." }).first().innerText(), /^Paragraph 2\./);
  log("accepted the insertion and rejected the deletion from the pane");

  // 5) open the saved file in a new document
  await newDoc(page);
  await page.evaluate((b) => window.__docsOpenBytes(b), bytes);
  await page.waitForFunction(() => document.querySelector(".ProseMirror")?.textContent?.includes("The end."), null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="page-footnotes"]')?.textContent?.includes("A footnote at the foot"), null, { timeout: 20000 });
  await page.waitForSelector('[data-testid="changes-pane"]');
  assert.equal(await page.locator(".ProseMirror ins.tc-ins").first().innerText(), "Annual ");
  assert.equal(await page.locator(".ProseMirror del.tc-del").first().innerText(), "Paragraph");
  assert.ok(await page.locator(".pl-endnotes").innerText().then((t) => t.includes("An endnote after the text.")));
  await waitLayout(page, "l.splits.some((s) => s.kind === 'row')", "table split after reopening");
  assert.deepEqual(await strayLines(page), [], "no text in the margins after reopening");
  await page.screenshot({ path: path.join(OUT, "3-reopened.png") });
  log("round trip: tracked changes, footnote, endnote and table header came back");

  // 6) LibreOffice opens the file
  if (existsSync("/usr/bin/soffice") || existsSync("/usr/bin/libreoffice")) {
    const prof = mkdtempSync(path.join(tmpdir(), "lo-"));
    try {
      execFileSync("soffice", [`-env:UserInstallation=file://${prof}`, "--headless", "--convert-to", "pdf", "--outdir", OUT, file], { stdio: "ignore", timeout: 180000 });
    } finally {
      rmSync(prof, { recursive: true, force: true });
    }
    const text = execFileSync("pdftotext", [path.join(OUT, "saved.pdf"), "-"]).toString();
    for (const s of ["Annual", "A footnote at the foot of the page.", "An endnote after the text.", "Row 45"]) assert.ok(text.includes(s), `LibreOffice text has ${s}`);
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(OUT, "saved.pdf")]).toString())?.[1]);
    log(`LibreOffice opens the saved file: ${pages} pages (ours: ${pagesBefore})`);
  }
  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
