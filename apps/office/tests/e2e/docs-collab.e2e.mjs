// Browser check for working together: @mentions in comments that notify the
// person named (the bell, and a link back to the comment), presence flags on
// the paragraph a co-author is in, and mail merge reading a Sheet's live state.
//
//   BASE_URL=http://127.0.0.1:3070 node tests/e2e/docs-collab.e2e.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3070";
const log = (...a) => console.log("•", ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-proxy-server"] });
const owner = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const ann = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-auth-request-email": "ann@example.com", "x-auth-request-preferred-username": "Ann Example" } });
const page = await owner.newPage();
const annPage = await ann.newPage();
for (const p of [page, annPage]) p.on("pageerror", (e) => console.error("pageerror:", e.message));
try {
  const me = (await (await page.request.get(`${BASE}/api/notifications`)).json());
  assert.ok(Array.isArray(me.items));
  // start from a clean slate (earlier runs share the database)
  assert.ok((await annPage.request.post(`${BASE}/api/notifications`, { data: { all: true } })).ok());
  assert.ok((await page.request.post(`${BASE}/api/notifications`, { data: { all: true } })).ok());
  const { id } = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "doc", title: `Plan ${Date.now()}` } })).json();
  assert.ok((await page.request.post(`${BASE}/api/docs/${id}/share`, { data: { email: "ann@example.com", role: "editor" } })).ok());
  await page.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await page.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await page.evaluate(() =>
    window.__docsEditor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First paragraph of the plan." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph needs a review." }] },
        { type: "paragraph", content: [{ type: "text", text: "Third paragraph." }] },
      ],
    }),
  );

  // ---- presence: Ann's cursor in the second paragraph shows on the owner's screen ----
  await annPage.goto(`${BASE}/doc/${id}`, { timeout: 120000 });
  await annPage.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await annPage.waitForFunction(() => window.__docsEditor.getText().includes("Second paragraph"), null, { timeout: 30000 });
  await annPage.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.startsWith("Second")) at = pos + 3;
    });
    ed.chain().focus().setTextSelection(at).run();
  });
  await page.waitForFunction(() => document.querySelectorAll(".ProseMirror .presence-block").length === 1, null, { timeout: 15000 });
  const flag = await page.evaluate(() => {
    const el = document.querySelector(".ProseMirror .presence-block");
    const c = el.cloneNode(true);
    c.querySelectorAll(".collaboration-cursor__caret").forEach((x) => x.remove());
    return { text: c.textContent, initials: el.getAttribute("data-presence-initials"), who: el.getAttribute("data-presence"), mark: getComputedStyle(el, "::after").content };
  });
  assert.match(flag.text, /^Second paragraph/);
  assert.ok(flag.initials && flag.initials.length >= 1, JSON.stringify(flag));
  assert.notEqual(flag.mark, "none");
  // Ann moves to the third paragraph; the flag follows
  await annPage.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.startsWith("Third")) at = pos + 4;
    });
    ed.chain().focus().setTextSelection(at).run();
  });
  await page.waitForFunction(() => /^Thi/.test(document.querySelector(".ProseMirror .presence-block")?.textContent || ""), null, { timeout: 15000 });
  // no flag for oneself
  const ownFlag = await annPage.evaluate(() => document.querySelector(".ProseMirror .presence-block")?.textContent || "");
  assert.ok(!/^Thi/.test(ownFlag), "Ann's own paragraph is not flagged for her");
  log("presence per paragraph:", flag.who, flag.initials);

  // ---- @mention: the owner mentions Ann in a comment ----
  await page.evaluate(() => {
    const ed = window.__docsEditor;
    let at = -1;
    ed.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text.startsWith("Second")) at = pos;
    });
    ed.chain().focus().setTextSelection({ from: at, to: at + 6 }).run();
  });
  await page.getByText("Insert", { exact: true }).first().click();
  await page.locator('[data-menu-item="Comment"]').first().click();
  const box = page.getByTestId("comment-input");
  await box.waitFor();
  await box.type("Could you check this @an");
  await page.getByTestId("mention-list").waitFor();
  await page.locator('[data-mention="ann@example.com"]').click();
  assert.equal(await box.inputValue(), "Could you check this @ann@example.com ");
  await box.type("please");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByTestId("mention-told").waitFor();
  assert.match(await page.getByTestId("mention-told").innerText(), /ann@example\.com/);
  await page.getByTestId("comment-mention").first().waitFor();
  assert.equal(await page.getByTestId("comment-mention").count(), 1);
  log("comment with an @mention posted");

  // Ann's bell shows it and links to the comment
  await annPage.reload();
  await annPage.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await annPage.getByTestId("notif-count").waitFor({ timeout: 15000 });
  assert.equal(await annPage.getByTestId("notif-count").innerText(), "1");
  await annPage.getByTestId("notif-bell").click();
  const item = annPage.locator("[data-notif]").first();
  assert.match(await item.innerText(), /mentioned you in/);
  assert.match(await item.innerText(), /Could you check this/);
  const href = await item.getAttribute("href");
  assert.match(href, new RegExp(`^/doc/${id}\\?comment=`));
  await item.click();
  await annPage.waitForURL(/comment=/);
  await annPage.waitForSelector(".ProseMirror.pl-root", { timeout: 120000 });
  await annPage.waitForSelector("[data-thread-card]", { timeout: 15000 });
  assert.equal(await annPage.locator("[data-thread-card].bg-amber-50\\/60").count(), 1, "the comment is shown");
  assert.equal(await annPage.getByTestId("comment-mention").first().getAttribute("class").then((c) => c.includes("amber")), true, "her own mention is highlighted");
  await annPage.waitForFunction(() => !document.querySelector('[data-testid="notif-count"]'), null, { timeout: 15000 });
  // a reply naming her again does not notify twice; the owner is not notified about their own name
  const thread = await annPage.locator("[data-thread-card]").first().getAttribute("data-thread-card");
  const r = await (await page.request.post(`${BASE}/api/docs/${id}/comments/${thread}`, { data: { body: "@ann@example.com one more thing" } })).json();
  assert.deepEqual(r.notified, []);
  // an outsider is never notified
  const r2 = await (await page.request.post(`${BASE}/api/docs/${id}/comments/${thread}`, { data: { body: "cc @stranger@example.org" } })).json();
  assert.deepEqual(r2.notified, []);
  // Ann mentions the owner in a reply: the owner is told
  const r3 = await (await annPage.request.post(`${BASE}/api/docs/${id}/comments/${thread}`, { data: { body: "Done, @shane@example.com" } })).json();
  assert.deepEqual(r3.notified, ["shane@example.com"]);
  const mine = await (await page.request.get(`${BASE}/api/notifications`)).json();
  assert.ok(mine.unread >= 1 && mine.items[0].actor_email === "ann@example.com");
  log("notifications delivered once, only to people who can open the document");

  // ---- mail merge reads the Sheet's live state ----
  const sheetTitle = `Live recipients ${Date.now()}`;
  const s = await (await page.request.post(`${BASE}/api/docs`, { data: { kind: "sheet", title: sheetTitle } })).json();
  const snapshot = {
    id: s.id, name: sheetTitle, appVersion: "", locale: "enUS", sheetOrder: ["s1"], styles: {},
    sheets: { s1: { id: "s1", name: "Sheet1", rowCount: 20, columnCount: 5, cellData: { 0: { 0: { v: "Name" } }, 1: { 0: { v: "Ada" } }, 2: { 0: { v: "Grace" } } } } },
  };
  assert.ok((await page.request.patch(`${BASE}/api/docs/${s.id}`, { data: { snapshot } })).ok());
  assert.ok((await page.request.post(`${BASE}/api/docs/${s.id}/share`, { data: { email: "ann@example.com", role: "editor" } })).ok());
  // Ann has the Sheet open
  await annPage.goto(`${BASE}/sheet/${s.id}`, { timeout: 120000 });
  await annPage.waitForFunction(() => !!window.__univer?.getActiveWorkbook?.(), null, { timeout: 120000 });
  await annPage.waitForTimeout(1500);
  // the owner picks it as the recipient list
  await page.getByText("Mailings", { exact: true }).first().click();
  await page.getByText("Mail merge from a Sheet…", { exact: true }).click();
  await page.getByTestId("merge-pane").waitFor();
  await page.waitForFunction((t) => [...document.querySelectorAll('[data-testid="merge-sheet"] option')].some((o) => o.textContent === t), sheetTitle);
  await page.getByTestId("merge-sheet").selectOption({ label: sheetTitle });
  await page.waitForFunction(() => /2 recipients/.test(document.querySelector('[data-testid="merge-count"]')?.textContent || ""), null, { timeout: 15000 });
  await page.getByTestId("merge-live").waitFor({ timeout: 15000 });
  // Ann adds a recipient; it shows up in the merge without anyone saving
  await annPage.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange(3, 0).setValue("Katherine"));
  await page.waitForFunction(() => /3 recipients/.test(document.querySelector('[data-testid="merge-count"]')?.textContent || ""), null, { timeout: 15000 });
  await annPage.evaluate(() => window.__univer.getActiveWorkbook().getActiveSheet().getRange(1, 0).setValue("Ada L."));
  await page.getByTestId("merge-field-btn").filter({ hasText: "Name" }).click();
  await page.getByTestId("merge-preview").check();
  await page.waitForFunction(() => [...document.querySelectorAll(".ProseMirror .word-merge")].map((e) => e.textContent).join() === "Ada L.", null, { timeout: 15000 });
  log("mail merge follows the open Sheet live");
  console.log("docs-collab e2e: OK");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/docs-collab-fail.png" }).catch(() => {});
  await annPage.screenshot({ path: "/tmp/docs-collab-fail-ann.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
