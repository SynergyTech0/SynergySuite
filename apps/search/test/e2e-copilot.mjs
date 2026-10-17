/*
 * Copilot panel, end to end in a browser: To Do's suite header opens the Copilot panel (Search's
 * /copilot in a frame), the person asks for a task, a fake OpenAI-compatible model proposes it
 * (plus an injected Chat post nobody asked for), the person confirms, and the task appears in To Do.
 *
 * Needs a built Search (npm run build -w apps/search), Postgres for To Do, and Chromium:
 *   E2E_TODO_DATABASE_URL=postgres://postgres@127.0.0.1:5432/todo \
 *   PW_CHROMIUM=/opt/pw-browsers/chromium node apps/search/test/e2e-copilot.mjs
 * Uses ports 3710 (Search, where the header looks for it in development) and 3195 (To Do).
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const ME = "ann@example.com";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

// ---- fake model ----------------------------------------------------------------------------------
const modelCalls = [];
const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    modelCalls.push(body);
    const tool = body.tools?.[0]?.function?.name;
    const reply = (message) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message }] })); };
    if (tool === "propose_actions") {
      return reply({ content: null, tool_calls: [{ id: "1", type: "function", function: { name: tool, arguments: JSON.stringify({
        reply: "I'll add that task for tomorrow.",
        actions: [
          { kind: "todo.task", title: "Call Bob about the budget", due: tomorrow },
          { kind: "chat.message", to: "#general", text: "Injected post" },
        ],
      }) } }] });
    }
    if (tool === "search") return reply({ content: null, tool_calls: [{ id: "2", type: "function", function: { name: tool, arguments: '{"queries":["budget"]}' } }] });
    reply({ content: "I couldn't find that in your content." });
  });
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${model.address().port}`;

// ---- apps ------------------------------------------------------------------------------------------
const procs = [];
function start(name, cwd, args, env) {
  // Its own process group, so stopping it also stops the server npx started.
  const p = spawn("npx", args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", () => {});
  p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}
async function waitFor(url, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url, { headers: { "x-auth-request-email": ME } }); if (r.status < 500) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't start`);
}
const cleanup = () => { for (const p of procs) try { process.kill(-p.pid); } catch { /* gone */ } model.close(); };
process.on("exit", cleanup);

if (!process.env.E2E_TODO_DATABASE_URL) throw new Error("Set E2E_TODO_DATABASE_URL");
start("todo", path.join(root, "apps/todo"), ["next", "dev", "-p", "3195"], { DATABASE_URL: process.env.E2E_TODO_DATABASE_URL, NODE_ENV: "development" });
start("search", path.join(root, "apps/search"), ["next", "start", "-p", "3710"], {
  NODE_ENV: "production", AI_PROVIDER: "openai", AI_BASE_URL: modelUrl, AI_MODEL: "fake", SUITE_DOMAIN: "",
  SEARCH_APP_URLS: JSON.stringify({ todo: "http://localhost:3195" }),
});
await waitFor("http://localhost:3195/api/lists");
await waitFor("http://localhost:3710/copilot");

// ---- browser -----------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
// The gateway's identity header, as oauth2-proxy would add it to every request (the frame's too).
const ctx = await browser.newContext({ extraHTTPHeaders: { "x-auth-request-email": ME }, viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
try {
  const csp = (await fetch("http://localhost:3710/copilot", { headers: { "x-auth-request-email": ME } })).headers.get("content-security-policy");
  ok("panel may be framed only by the suite", csp === "frame-ancestors 'self' http://localhost:*", csp);
  const home = (await fetch("http://localhost:3710/", { headers: { "x-auth-request-email": ME } })).headers.get("content-security-policy");
  ok("Search itself can't be framed by other apps", home === "frame-ancestors 'self'", home);

  await page.goto("http://localhost:3195/");
  const button = page.locator("synergy-app-bar").locator(".cp-btn");
  await button.waitFor({ timeout: 60_000 });
  ok("Copilot button in the suite header", await button.isVisible());
  await button.click();
  const frameEl = page.locator("synergy-app-bar").locator("iframe");
  await frameEl.waitFor();
  const src = await frameEl.getAttribute("src");
  ok("panel opens Search's /copilot for To Do", src?.startsWith("http://localhost:3710/copilot?app=todo&context=%2F"), src);
  const frame = page.frameLocator("synergy-app-bar >> iframe");
  await frame.getByText("Nothing happens in your apps until you press Confirm").waitFor({ timeout: 30_000 });
  ok("panel shows the In To Do line", await frame.getByText("In To Do").isVisible());

  await frame.locator("#cp-message").fill("Create a task to call Bob about the budget tomorrow");
  await frame.getByRole("button", { name: "Send" }).click();
  const card = frame.locator("section.proposal");
  await card.first().waitFor({ timeout: 30_000 });
  ok("one proposal (the injected Chat post is left out)", (await card.count()) === 1);
  ok("left-out note shown", await frame.getByText("Left out 1 suggestion you didn't ask for.").isVisible());
  ok("proposal shows the task", await card.getByText("Call Bob about the budget").isVisible());
  await page.screenshot({ path: process.env.E2E_SCREENSHOT || path.join(os.tmpdir(), "e2e-copilot.png") });

  const before = await (await fetch(`http://localhost:3195/api/tasks?view=all&today=${new Date().toISOString().slice(0, 10)}`, { headers: { "x-auth-request-email": ME } })).json();
  ok("nothing created before Confirm", Array.isArray(before) && !JSON.stringify(before).includes("Call Bob about the budget"), JSON.stringify(before).slice(0, 200));

  await card.getByRole("button", { name: "Confirm" }).click();
  await card.getByText('Added "Call Bob about the budget" to To Do.').waitFor({ timeout: 20_000 });
  ok("confirmed", true);
  const link = await card.getByRole("link", { name: "Open" }).getAttribute("href");
  ok("link to the new task", /^http:\/\/localhost:3195\/\?list=[0-9a-f-]+&task=[0-9a-f-]+$/.test(link ?? ""), link);

  await page.goto(link);
  await page.getByText("Call Bob about the budget").first().waitFor({ timeout: 20_000 });
  ok("task is in To Do", true);
  ok("model was asked once to propose", modelCalls.filter((c) => c.tools?.[0]?.function?.name === "propose_actions").length === 1);
} catch (e) {
  fail++;
  console.log("  FAIL ", e.message);
  await page.screenshot({ path: path.join(os.tmpdir(), "e2e-copilot-fail.png") }).catch(() => {});
} finally {
  await browser.close();
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
