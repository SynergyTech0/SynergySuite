// Browser check for restrict editing: content controls (check box, drop-down,
// date), a read-only document with an editable exception and a password,
// filling in a form, and the .docx protection settings.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-protection.e2e.mjs
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
page.on("dialog", (d) => d.accept(d.message().startsWith("Items") ? "Red, Green, Blue" : undefined));
const menu = async (...path) => {
  await page.getByText(path[0], { exact: true }).first().click();
  for (const p of path.slice(1)) await page.locator(`[data-menu-item="${p}"]`).first().click();
};
const json = () => page.evaluate(() => window.__docsEditor.getJSON());
const textOf = (n) => (n.text || "") + (n.content || []).map(textOf).join("");
const cursorAt = (t, off = 0) =>
  page.evaluate(([t, o]) => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.includes(t)) at = pos + n.text.indexOf(t);
    });
    ed.chain().focus().setTextSelection(at + o).run();
  }, [t, off]);
try {
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc" } })).json();
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Contract terms are fixed." }] },
        { type: "paragraph", content: [{ type: "text", text: "Signer notes: none" }] },
        { type: "paragraph", content: [{ type: "text", text: "Agree: " }] },
      ],
    }),
  );

  // content controls: a check box, a drop-down and a date picker
  await cursorAt("Agree: ", 7);
  await menu("Insert", "Content control", "Check box content control");
  await menu("Insert", "Content control", "Drop-down list content control");
  await menu("Insert", "Content control", "Date picker content control");
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .word-cc").length === 3);
  await page.locator('.ProseMirror .word-cc[data-cc-kind="checkbox"]').click();
  await page.waitForFunction(() => document.querySelector('.ProseMirror .word-cc[data-cc-kind="checkbox"]').textContent.includes("☒"));
  await page.locator('.ProseMirror .word-cc[data-cc-kind="dropdown"] [data-cc-pick]').click();
  await page.locator('[data-cc-item="Green"]').click();
  await page.locator('.ProseMirror .word-cc[data-cc-kind="date"] [data-cc-pick]').click();
  await page.getByLabel("Control date").fill("2024-03-05");
  await page.getByTestId("cc-date-ok").click();
  const ccs = (await json()).content[2].content.filter((n) => n.type === "contentControl");
  assert.deepEqual(ccs.map((c) => [c.attrs.kind, textOf(c)]), [["checkbox", "☒"], ["dropdown", "Green"], ["date", "3/5/2024"]]);
  assert.equal(ccs[0].attrs.checked, true);
  log("check box, drop-down and date picker filled in");

  // read only with an exception, protected by a password
  await menu("Review", "Restrict editing");
  await page.getByLabel("Allow only this type of editing").check();
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let a = -1;
    ed.state.doc.descendants((n, pos) => {
      if (a < 0 && n.isText && n.text.includes("none")) a = pos + n.text.indexOf("none");
    });
    ed.chain().focus().setTextSelection({ from: a, to: a + 4 }).run();
  });
  await page.getByTestId("exception-add").click();
  await page.getByTestId("protection-start").click();
  await page.getByLabel("Protection password").fill("pw1");
  await page.getByLabel("Reenter password").fill("pw1");
  await page.getByTestId("protection-ok").click();
  await page.getByTestId("protection-status").waitFor();
  await page.waitForSelector('.ProseMirror[data-protected="readOnly"] .editable-range');
  await cursorAt("Contract", 3);
  await page.keyboard.type("XYZ");
  await cursorAt("none", 4);
  await page.keyboard.type(" at all");
  const after = await json();
  assert.equal(textOf(after.content[0]), "Contract terms are fixed.");
  assert.equal(textOf(after.content[1]), "Signer notes: none at all");
  log("read only: fixed text kept, the exception edited");

  // the .docx carries the protection and the exception
  const bytes = await page.evaluate(() => window.__docsExportBytes());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.match(await zip.file("word/settings.xml").async("string"), /<w:documentProtection w:edit="readOnly" w:enforcement="1"\/>/);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /<w:permStart w:id="\d+" w:edGrp="everyone"\/>/);
  assert.match(xml, /<w14:checkbox>/);
  assert.match(xml, /<w:dropDownList>/);
  log("protection and controls in the .docx");

  // stop protection: wrong password, then the right one
  await page.getByTestId("protection-stop").click();
  await page.getByLabel("Protection password").fill("bad");
  await page.getByTestId("protection-ok").click();
  await page.getByText("The password is incorrect.").waitFor();
  await page.getByLabel("Protection password").fill("pw1");
  await page.getByTestId("protection-ok").click();
  await page.waitForFunction(() => !document.querySelector(".ProseMirror[data-protected]"));
  await cursorAt("Contract", 8);
  await page.keyboard.type("!");
  assert.equal(textOf((await json()).content[0]), "Contract! terms are fixed.");
  log("protection stopped with the password");
  console.log("docs protection e2e: all checks passed");
} finally {
  await browser.close();
}
