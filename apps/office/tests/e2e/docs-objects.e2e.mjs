// Browser check for Docs milestone 2 floating objects: a picture with square
// wrapping on the right, a text box and a shape, wrap and position from the
// layout dialog, moving and resizing by mouse, and the .docx round trip
// (checked in LibreOffice when it is installed).
//
// Needs a running office app + collab server and Playwright with Chromium:
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-objects.e2e.mjs
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
const OUT = mkdtempSync(path.join(tmpdir(), "docs-e2e4-"));
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
const box = (sel) => page.locator(sel).first().boundingBox();
const attrsOf = (type, i = 0) =>
  page.evaluate(([t, k]) => {
    const out = [];
    window.__docsEditor.state.doc.descendants((n, pos) => {
      if (n.type.name === t) out.push({ pos, ...n.attrs });
    });
    return out[k];
  }, [type, i]);
try {
  await newDoc(page);
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    const g = c.getContext("2d");
    g.fillStyle = "#16a34a";
    g.fillRect(0, 0, 160, 120);
    const words = "The quick brown fox jumps over the lazy dog while the river runs past the old mill and the bells ring in the tower. ";
    const p = (i) => ({ type: "paragraph", content: [{ type: "text", text: `Paragraph ${i}. ` + words.repeat(3) }] });
    window.__docsEditor.commands.setContent({ type: "doc", content: [p(1), { type: "image", attrs: { src: c.toDataURL("image/png"), width: 160, height: 120 } }, p(2), p(3), p(4), p(5)] });
  });
  await page.waitForSelector(".ProseMirror .word-image img");
  // the picture arrived as a data: URL; it moves to a media file beside the document
  await page.waitForFunction(() => document.querySelector(".ProseMirror .word-image img")?.getAttribute("src")?.startsWith("/api/docs/"), null, { timeout: 20000 });
  const stored = await page.evaluate(() => fetch(document.querySelector(".ProseMirror .word-image img").getAttribute("src")).then((r) => [r.status, r.headers.get("content-type")]));
  assert.deepEqual(stored, [200, "image/png"]);
  log("the data: URL picture was stored as media (/api/docs/…/media/…, image/png)");

  // 1) picture: square wrapping on the right, from the layout dialog
  await page.locator(".ProseMirror .word-image img").dblclick();
  await page.locator('[data-testid="layout-wrap"]').selectOption("square");
  await page.locator('[data-testid="layout-align"]').selectOption("right");
  await page.locator('[data-testid="layout-apply"]').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ProseMirror .word-image")).float === "right");
  await page.waitForTimeout(300);
  const img = await box(".ProseMirror .word-image img");
  const p2 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((x) => x.textContent.startsWith("Paragraph 2."));
    const r = document.createRange();
    r.selectNodeContents(p);
    const rects = [...r.getClientRects()];
    return { firstRight: Math.max(...rects.filter((q) => q.top < rects[0].top + 5).map((q) => q.right)), top: rects[0].top };
  });
  assert.ok(p2.firstRight < img.x, `text wraps to the left of the picture (${p2.firstRight} < ${img.x})`);
  assert.ok(Math.abs(p2.top - img.y) < 30, "the text starts beside the picture");
  log("picture: square wrapping on the right, the next paragraph flows beside it");

  // 2) a text box beside paragraph 4
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isTextblock && n.textContent.startsWith("Paragraph 4.")) at = pos + 3;
    });
    ed.chain().focus().setTextSelection(at).run();
  });
  await page.waitForFunction(() => document.activeElement?.classList.contains("ProseMirror"));
  await menu(page, "Insert", "Text box");
  await page.keyboard.type("Note text inside the box");
  await page.waitForFunction(() => document.querySelector(".ProseMirror .word-shape-text")?.textContent === "Note text inside the box");
  const tb = await attrsOf("shape");
  assert.deepEqual([tb.textBox, tb.wrap], [true, "square"]);
  const tbBox = await box(".ProseMirror .word-shape");
  const p4 = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((x) => x.textContent.startsWith("Paragraph 4."));
    const r = document.createRange();
    r.selectNodeContents(p.firstChild);
    return r.getClientRects()[0].left;
  });
  assert.ok(p4 > tbBox.x + tbBox.width - 2, "paragraph 4 starts to the right of the text box");
  // resize by the corner handle
  await page.locator(".ProseMirror .word-shape .word-shape-grip").first().click();
  const h = await box(".ProseMirror .word-shape .word-shape-handle");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    let w = 0;
    window.__docsEditor.state.doc.descendants((n) => {
      if (n.type.name === "shape") w = n.attrs.width;
    });
    return w >= 290;
  });
  log("text box: inserted beside paragraph 4 with text wrapping around it, resized by its corner");

  // 3) an oval in front of text, positioned from the dialog, then dragged
  await page.evaluate(() => window.__docsEditor.chain().focus().setTextSelection(3).run());
  await menu(page, "Insert", "Shape…");
  await page.locator('[data-testid="shape-ellipse"]').click();
  await page.locator('[data-testid="layout-wrap"]').selectOption("front");
  await page.locator('[data-testid="layout-x"]').fill("380");
  await page.locator('[data-testid="layout-y"]').fill("10");
  await page.locator('[data-testid="layout-apply"]').click();
  await page.keyboard.type("Oval");
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-shape-wrap")].some((w) => getComputedStyle(w).position === "absolute"));
  const oval0 = await attrsOf("shape", 0);
  assert.deepEqual([oval0.kind, oval0.wrap, oval0.offsetX, oval0.offsetY], ["ellipse", "front", 380, 10]);
  const ovalBox = await box('.ProseMirror .word-shape-wrap[data-wrap="front"] .word-shape');
  const rootBox = await box(".ProseMirror.pl-root");
  assert.ok(ovalBox.x - rootBox.x > 380, "the oval sits at its horizontal offset");
  const grip = await box('.ProseMirror .word-shape-wrap[data-wrap="front"] .word-shape-grip');
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 45, grip.y + 35, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    let a = null;
    window.__docsEditor.state.doc.descendants((n) => {
      if (n.type.name === "shape" && n.attrs.kind === "ellipse") a = n.attrs;
    });
    return a && a.offsetX >= 415 && a.offsetY >= 40;
  });
  await page.screenshot({ path: path.join(OUT, "1-objects.png") });
  log("shape: an oval in front of text at an offset from the dialog, moved by dragging its grip");

  // a picture from a file: Insert > Picture (upload)…
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    ed.chain().focus().setTextSelection(ed.state.doc.content.size - 1).run();
  });
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "Insert", "Picture (upload)…");
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64") });
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .word-image img").length === 2, null, { timeout: 20000 });
  const up = await attrsOf("image", 1);
  assert.match(up.src, /^\/api\/docs\/[^/]+\/media\/[\w-]+$/);
  assert.deepEqual([up.width, up.height, up.alt], [2, 2, "dot"]);
  // a non-image is refused by the server
  const refused = await page.evaluate(() => fetch(location.pathname.replace("/doc/", "/api/docs/") + "/images", { method: "POST", headers: { "Content-Type": "image/png" }, body: "<svg/>" }).then((r) => r.status));
  assert.equal(refused, 415);
  log("Insert > Picture (upload) stored the file as media; a non-image upload is refused (415)");

  // a pasted picture file is uploaded too
  await page.evaluate(async () => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent.startsWith("Paragraph 5.")) at = pos + n.nodeSize - 1;
    });
    ed.chain().focus().setTextSelection(at).run();
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.querySelector(".ProseMirror.pl-root").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .word-image img").length === 3, null, { timeout: 20000 });
  assert.match((await attrsOf("image", 2)).src, /^\/api\/docs\//);
  await page.evaluate(() => {
    let at = -1;
    window.__docsEditor.state.doc.descendants((n, pos) => {
      if (n.type.name === "image" && n.attrs.alt === "pasted") at = pos;
    });
    window.__docsEditor.chain().deleteRange({ from: at, to: at + 1 }).run();
  });
  log("a pasted picture file was uploaded as media");

  // the server PDF is made from the document's .docx (sections, styles, text boxes)
  const dl = page.waitForEvent("download", { timeout: 180000 });
  await menu(page, "File", "Download as PDF (.pdf)");
  const pdfPath = path.join(OUT, "objects-server.pdf");
  await (await dl).saveAs(pdfPath);
  const head = (await import("node:fs")).readFileSync(pdfPath).subarray(0, 5).toString();
  assert.equal(head, "%PDF-");
  if (existsSync("/usr/bin/pdftotext")) {
    const t = execFileSync("pdftotext", [pdfPath, "-"]).toString().replace(/\s+/g, " ");
    for (const x of ["Paragraph 1.", "Note text inside the box", "Oval"]) assert.ok(t.includes(x), `server PDF has ${x}`);
  }
  log("Download as PDF: the server converted the document's own .docx (text box and shape text included)");

  // 4) .docx round trip
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const file = path.join(OUT, "objects.docx");
  writeFileSync(file, Buffer.from(bytes));
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /<wp:anchor [^>]*>.*?<wp:align>right<\/wp:align>.*?<wp:wrapSquare wrapText="bothSides"\/>.*?<pic:pic>/);
  assert.match(xml, /<wps:cNvSpPr txBox="1"\/>.*?Note text inside the box/);
  assert.match(xml, /<a:prstGeom prst="ellipse">.*?Oval/);
  assert.match(xml, /<wp:wrapNone\/>/);
  await newDoc(page);
  await page.evaluate((b) => window.__docsOpenBytes(b), bytes);
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .word-shape").length === 2, null, { timeout: 60000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ProseMirror .word-image")).float === "right");
  const back = await page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.descendants((n) => {
      if (n.type.name === "shape" || n.type.name === "image") out.push([n.type.name, n.attrs.wrap, n.attrs.kind || null, n.textContent]);
    });
    return out;
  });
  assert.deepEqual(back.map((b) => b.slice(0, 3)), [["shape", "front", "ellipse"], ["image", "square", null], ["shape", "square", "rect"], ["image", "inline", null]]);
  assert.equal(back[2][3], "Note text inside the box");
  // the reopened file's pictures are stored as media again
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-image img")].every((i) => i.getAttribute("src").startsWith("/api/docs/")), null, { timeout: 20000 });
  log("round trip: wrap, position, geometry and text of the pictures, text box and shape came back; pictures stored as media");

  if (existsSync("/usr/bin/soffice") || existsSync("/usr/bin/libreoffice")) {
    const prof = mkdtempSync(path.join(tmpdir(), "lo-"));
    try {
      execFileSync("soffice", [`-env:UserInstallation=file://${prof}`, "--headless", "--convert-to", "pdf", "--outdir", OUT, file], { stdio: "ignore", timeout: 180000 });
    } finally {
      rmSync(prof, { recursive: true, force: true });
    }
    const text = execFileSync("pdftotext", [path.join(OUT, "objects.pdf"), "-"]).toString().replace(/\s+/g, " ");
    for (const s of ["Note text inside the box", "Oval", "Paragraph 5."]) assert.ok(text.includes(s), `LibreOffice text has ${s}`);
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [path.join(OUT, "objects.pdf")]).toString())?.[1]);
    log(`LibreOffice opens the file with the text box and shape text (${pages} page${pages > 1 ? "s" : ""})`);
  }
  console.log(`PASS — screenshots and files in ${OUT}`);
} catch (e) {
  await page.screenshot({ path: path.join(OUT, "failure.png") }).catch(() => {});
  console.error(`FAIL — see ${OUT}`);
  throw e;
} finally {
  await browser.close();
}
