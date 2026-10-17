import test from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

// The bundle defines <synergy-app-bar> as it loads, so the page has to exist first.
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://chat.example.com/" });
for (const k of ["window", "document", "HTMLElement", "customElements", "sessionStorage", "location"]) globalThis[k] = dom.window[k];

let answer = () => Promise.reject(new TypeError("Failed to fetch"));
const calls = [];
globalThis.fetch = (url, init) => {
  calls.push({ url, init });
  return answer();
};
const reply = (status, body) => () => Promise.resolve({ ok: status === 200, status, json: async () => body });

const { launcherLinks } = await import("../dist/app-bar.js");
const settle = () => new Promise((r) => setTimeout(r, 10));

const GROUPS = [
  { category: "Work", apps: [
    { slug: "mail", name: "Mail", url: "http://stale.example.net", suite: true },
    { slug: "chat", name: "Chat", url: "", suite: true },
  ] },
  { category: "Company", apps: [
    { slug: "wiki", name: "Wiki", url: "https://wiki.corp.test/", suite: false },
    { slug: "evil", name: "Evil", url: "javascript:alert(1)", suite: false },
  ] },
  { category: "Empty", apps: [{ slug: "bad", name: "Bad", url: "data:text/html,x", suite: false }] },
];

async function bar(attrs = { app: "chat", user: "jane@example.com", domain: "example.com" }) {
  const el = document.createElement("synergy-app-bar");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await settle();
  const nav = el.shadowRoot.querySelector("nav");
  const links = [...nav.querySelectorAll("a")];
  return { el, nav, links, names: links.map((a) => a.textContent), headings: [...nav.querySelectorAll("h2")].map((h) => h.textContent) };
}

function reset() {
  document.body.innerHTML = "";
  sessionStorage.clear();
  calls.length = 0;
}

test("without Account's list the launcher lists the suite apps as one group", () => {
  const [g, ...rest] = launcherLinks(null, "example.com");
  assert.strictEqual(rest.length, 0);
  assert.ok(g.links.some((l) => l.id === "mail" && l.href === "https://mail.example.com"));
  assert.ok(!g.links.some((l) => l.id === "sign"), "apps that aren't core stay out");
  assert.ok(launcherLinks(null, null)[0].links.every((l) => l.href.startsWith("http://localhost:")));
});

test("Account's groups: suite apps follow the bar's domain, linked apps keep their http(s) address", () => {
  const groups = launcherLinks(GROUPS, "example.com");
  assert.deepStrictEqual(groups.map((g) => g.category), ["Work", "Company"]);
  assert.deepStrictEqual(groups[0].links.map((l) => l.href), ["https://mail.example.com", "https://chat.example.com"]);
  assert.deepStrictEqual(groups[1].links, [{ id: "wiki", name: "Wiki", href: "https://wiki.corp.test/" }]);
  assert.strictEqual(launcherLinks(GROUPS, null)[0].links[0].href, "http://localhost:3200");
});

test("the bar swaps in the signed-in person's grouped list from Account", async () => {
  reset();
  answer = reply(200, { groups: GROUPS });
  const { names, headings, links } = await bar();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "https://auth.example.com/api/launcher");
  assert.strictEqual(calls[0].init.credentials, "include");
  assert.deepStrictEqual(headings, ["Work", "Company"]);
  assert.deepStrictEqual(names, ["Mail", "Chat", "Wiki", "All apps"]);
  assert.ok(links.find((a) => a.textContent === "Chat").hasAttribute("aria-current"));
  assert.strictEqual(links.at(-1).getAttribute("href"), "https://auth.example.com/hub");
});

test("the list is kept for the session, so the next page shows it without asking again", async () => {
  reset();
  answer = reply(200, { groups: GROUPS });
  await bar();
  document.body.innerHTML = "";
  calls.length = 0;
  answer = () => Promise.reject(new Error("should not be called"));
  const { names } = await bar();
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(names, ["Mail", "Chat", "Wiki", "All apps"]);
});

for (const [why, a] of [
  ["Account is unreachable", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["signed out", reply(401, { error: "unauthenticated" })],
  ["Account answers nonsense", reply(200, { groups: "nope" })],
]) {
  test(`falls back to the suite apps when ${why}`, async () => {
    reset();
    answer = a;
    const { names, headings } = await bar();
    assert.deepStrictEqual(headings, []);
    assert.ok(names.includes("Mail") && names.includes("Calendar"));
    assert.strictEqual(names.at(-1), "All apps");
    assert.strictEqual(sessionStorage.length, 0);
  });
}

test("no domain: asks Account on localhost and still falls back", async () => {
  reset();
  answer = reply(401, {});
  const { names } = await bar({ app: "chat" });
  assert.strictEqual(calls[0].url, "http://localhost:3500/api/launcher");
  assert.ok(names.includes("Mail"));
});

test("Escape closes the launcher and keeps focus on its button", async () => {
  reset();
  answer = reply(200, { groups: GROUPS });
  const { el, nav } = await bar();
  const button = el.shadowRoot.querySelector("button");
  button.click();
  assert.strictEqual(nav.hidden, false);
  button.focus();
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.strictEqual(nav.hidden, true);
  assert.strictEqual(el.shadowRoot.activeElement, button);
});
