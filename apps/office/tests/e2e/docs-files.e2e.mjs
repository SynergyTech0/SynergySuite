// Browser check for plain files and templates: open a Markdown file, save as
// .txt, .md and .dotx, open the .dotx back as a new document, open a .docm
// without its macros, and insert a text file at the cursor.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-files.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const JSZip = require("jszip");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
const json = () => page.evaluate(() => window.__docsEditor.getJSON());
const fileMenu = async (label) => {
  await page.getByText("File", { exact: true }).first().click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(`[data-menu-item="${label}"]`).click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
};
const open = async (id) => {
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
};
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: "Notes" } })).json();
  await open(id);

  // open Markdown
  const md = "# Notes\n\nSome **bold** text and a [link](https://example.com).\n\n- [x] done\n- [ ] todo\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";
  await page.getByTestId("docx-input").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from(md) });
  await page.waitForFunction(() => window.__docsEditor.getJSON().content[0]?.type === "heading");
  const d = await json();
  assert.deepEqual(d.content.map((n) => n.type), ["heading", "paragraph", "taskList", "table"]);
  log("opened a Markdown file");

  // save as .md and .txt
  const mdOut = await fileMenu("Download as Markdown (.md)");
  assert.equal(mdOut.name, "Notes.md");
  assert.equal(mdOut.bytes.toString(), "# Notes\n\nSome **bold** text and a [link](https://example.com).\n\n- [x] done\n- [ ] todo\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
  const txt = await fileMenu("Download as Plain text (.txt)");
  assert.equal(txt.bytes.toString(), "Notes\r\nSome bold text and a link.\r\n☒ done\r\n☐ todo\r\nA\tB\r\n1\t2");
  log("saved as .md and .txt");

  // save as a template; a new document from it on the documents list
  const dotx = await fileMenu("Download as Word template (.dotx)");
  assert.equal(dotx.name, "Notes.dotx");
  const ct = await (await JSZip.loadAsync(dotx.bytes)).file("[Content_Types].xml").async("string");
  assert.match(ct, /wordprocessingml\.template\.main\+xml/);
  await page.goto(`${BASE}/`, { timeout: 120000 });
  await page.getByTestId("doclist-docx").setInputFiles({ name: "Notes.dotx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.template", buffer: dotx.bytes });
  await page.waitForURL(/\/doc\//, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.waitForFunction(() => window.__docsEditor?.getJSON().content[0]?.content?.[0]?.text === "Notes", null, { timeout: 60000 });
  const newId = page.url().split("/doc/")[1];
  assert.notEqual(newId, id);
  const meta = await (await page.request.get(`${BASE}/api/docs/${newId}`)).json();
  assert.equal(meta.title ?? meta.doc?.title ?? "", "");
  log("new document from a .dotx template");

  // a .docm opens without its macros
  const zip = await JSZip.loadAsync(dotx.bytes);
  let c2 = await zip.file("[Content_Types].xml").async("string");
  c2 = c2.replace("application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml", "application/vnd.ms-word.document.macroEnabled.main+xml").replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  zip.file("[Content_Types].xml", c2);
  zip.file("word/vbaProject.bin", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  const docm = await zip.generateAsync({ type: "nodebuffer" });
  await page.getByTestId("docx-input").setInputFiles({ name: "macro.docm", mimeType: "application/vnd.ms-word.document.macroEnabled.12", buffer: docm });
  await page.waitForFunction(() => window.__docsEditor.getJSON().content.some((n) => n.type === "table"));
  const out = await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.__docsExportBytes())));
  assert.equal(out.file("word/vbaProject.bin"), null);
  log("opened a .docm without macros");

  // Insert > Text from file
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    ed.chain().focus().setTextSelection(ed.state.doc.content.size - 1).run();
  });
  await page.getByTestId("insert-file-input").setInputFiles({ name: "extra.txt", mimeType: "text/plain", buffer: Buffer.from("Inserted line one\r\nInserted line two\r\n") });
  await page.waitForFunction(() => JSON.stringify(window.__docsEditor.getJSON()).includes("Inserted line two"));
  const after = await json();
  assert.ok(after.content.some((n) => n.type === "heading"));
  log("inserted a text file");
  console.log("docs files e2e: all checks passed");
} finally {
  await browser.close();
}
