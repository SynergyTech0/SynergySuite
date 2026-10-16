// A stand-in for suite apps that answer the compliance protocol, for tests and trying the
// Admin center locally. Each app lives under its own path: http://127.0.0.1:<port>/<app>.
//   node apps/admin/test/fake-compliance.mjs [port]     (COMPLIANCE_TOKEN, default dev-token)
// then COMPLIANCE_APP_URLS='{"mail":"http://127.0.0.1:4790/mail","drive":"http://127.0.0.1:4790/drive"}'
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { parseQuery, matchesQuery, MAX_PAGE, MAX_EXPORT_IDS } = require("@synergy/compliance");

const DAY = 86400000;
const BASE = Date.parse("2026-09-01T09:00:00Z");
const PEOPLE = ["alice@example.com", "bob@example.com", "carol@example.com"];

/** Content per app: mail messages, drive files (with attachments) and chat messages. */
export function sampleData(perApp = 30) {
  const data = { mail: [], drive: [], chat: [] };
  for (let i = 0; i < perApp; i++) {
    const owner = PEOPLE[i % PEOPLE.length];
    const other = PEOPLE[(i + 1) % PEOPLE.length];
    const topic = i % 3 === 0 ? "Northwind contract" : i % 3 === 1 ? "quarterly budget" : "team lunch";
    data.mail.push({
      id: `msg-${i}`, kind: "message", title: `Re: ${topic} #${i}`, owner, participants: [other],
      date: new Date(BASE + i * DAY).toISOString(), text: `Hello ${other}, about the ${topic}. Item ${i}.`,
      html: `<p>Hello <b>${other}</b>, about the ${topic}. Item ${i}.</p>`, deleted: i === 3,
      attachments: i % 5 === 0 ? [{ name: `notes-${i}.txt`, type: "text/plain", body: `Attached notes for ${topic} ${i}` }] : [],
      metadata: { folder: "INBOX", subject: `Re: ${topic} #${i}` },
    });
    data.drive.push({
      id: `file/${i}`, kind: "file", title: `${topic.replace(/ /g, "-")}-${i}.txt`, owner, participants: [],
      date: new Date(BASE + i * DAY + 3600000).toISOString(), text: `Document about the ${topic}, revision ${i}.`,
      attachments: [{ name: `${topic.replace(/ /g, "-")}-${i}.txt`, type: "text/plain", body: `File body: ${topic} ${i}` }],
      metadata: { path: `/Documents/${topic}` },
    });
    data.chat.push({
      id: `chat-${i}`, kind: "message", title: `Message in #general`, owner, participants: [other],
      date: new Date(BASE + i * DAY + 7200000).toISOString(), text: `${owner.split("@")[0]}: anyone have news on the ${topic}?`,
      metadata: { channel: "general" },
    });
  }
  return data;
}

function hitOf(app, it, query) {
  const text = it.text ?? "";
  const term = parseQuery(query).groups[0]?.[0];
  const idx = term ? text.toLowerCase().indexOf(term) : 0;
  const at = idx > 120 ? text.lastIndexOf(" ", idx - 40) + 1 : 0;
  return {
    id: it.id, kind: it.kind, title: it.title, owner: it.owner, participants: it.participants, date: it.date,
    snippet: text.slice(at, at + 200), size: text.length, ...(it.deleted ? { deleted: true } : {}),
  };
}

// A sign-in service's SCIM Users API too, at /scim/api/scim/v2/Users (Bearer sascim_test), so the
// People page has someone to show: AUTH_INTERNAL_URL=http://127.0.0.1:<port>/scim.
const users = [
  ["shane@example.com", "Shane Admin"], ["alice@example.com", "Alice Archer"], ["bob@example.com", "Bob Baker"],
  ["carol@example.com", "Carol Chen"], ["dave@example.com", "Dave Diaz"],
].map(([email, name], i) => ({ id: String(i + 1), userName: email, name: { formatted: name }, active: i !== 4, meta: { created: new Date(BASE - (40 - i) * DAY).toISOString() } }));

async function scim(req, path, send) {
  if (req.headers.authorization !== "Bearer sascim_test") return send(401, { detail: "Invalid or missing bearer token" });
  let body = {};
  if (req.method !== "GET") body = JSON.parse(await new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s || "{}")); }));
  const m = path.match(/^\/api\/scim\/v2\/Users(?:\/(\w+))?$/);
  if (!m) return send(404, { detail: "Unsupported" });
  if (!m[1] && req.method === "GET") return send(200, { totalResults: users.length, startIndex: 1, itemsPerPage: users.length, Resources: users });
  if (!m[1] && req.method === "POST") {
    if (users.some((u) => u.userName === body.userName)) return send(409, { detail: "User already exists" });
    const u = { id: String(users.length + 1), userName: body.userName, name: { formatted: body.name?.formatted ?? body.userName }, active: body.active !== false, meta: { created: new Date().toISOString() } };
    users.push(u);
    return send(201, u);
  }
  const u = users.find((x) => x.id === m[1]);
  if (!u) return send(404, { detail: "User not found" });
  if (req.method === "PATCH") for (const op of body.Operations ?? []) if (typeof op.value?.active === "boolean") u.active = op.value.active;
  return send(200, u);
}

/**
 * Starts the fake. `behave` maps an app to "slow" (answers after `slowMs`), "broken" (500) or
 * "nosupport" (404). Resolves with the server and its base URL.
 */
export function startFakeApp({ port = 0, token = process.env.COMPLIANCE_TOKEN || "dev-token", data = sampleData(), behave = {}, slowMs = 3000 } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const [, app, ...rest] = (req.url ?? "/").split("?")[0].split("/");
    const path = "/" + rest.join("/");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (app === "scim") return scim(req, path, send);
    if (req.method === "GET" && path === "/") return send(200, { app });
    if (!data[app] && !behave[app]) return send(404, { error: "Not found" });
    if (behave[app] === "nosupport") return send(404, { error: "Not found" });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized" });
    let body = {};
    try {
      body = JSON.parse(await new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s || "{}")); }));
    } catch {
      return send(400, { error: "Bad body" });
    }
    calls.push({ app, path, body });
    if (behave[app] === "slow") await new Promise((ok) => setTimeout(ok, slowMs));
    if (behave[app] === "broken") return send(500, { error: "boom" });
    const items = data[app] ?? [];
    if (path === "/api/compliance/search") {
      const p = parseQuery(body.query);
      const who = body.custodians ?? [];
      const list = items
        .filter((it) => matchesQuery(`${it.title} ${it.text ?? ""}`, p))
        .filter((it) => !who.length || who.includes(it.owner) || it.participants.some((x) => who.includes(x)))
        .filter((it) => (!body.from || it.date.slice(0, 10) >= body.from) && (!body.to || it.date.slice(0, 10) <= body.to))
        .filter((it) => !body.kinds?.length || body.kinds.includes(it.kind))
        .sort((a, b) => b.date.localeCompare(a.date));
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), MAX_PAGE);
      const offset = body.cursor ? Number(Buffer.from(body.cursor, "base64").toString()) : 0;
      const page = list.slice(offset, offset + limit);
      const next = offset + limit < list.length ? Buffer.from(String(offset + limit)).toString("base64") : undefined;
      return send(200, { app, hits: page.map((it) => hitOf(app, it, body.query)), total: list.length, ...(next ? { nextCursor: next } : {}) });
    }
    if (path === "/api/compliance/export") {
      if (!Array.isArray(body.ids) || body.ids.length > MAX_EXPORT_IDS) return send(400, { error: "Bad ids" });
      const out = body.ids.map((id) => items.find((it) => it.id === id)).filter(Boolean).map((it) => ({
        ...hitOf(app, it, ""), app, metadata: it.metadata ?? {}, text: it.text, html: it.html,
        attachments: (it.attachments ?? []).map((a) => ({ name: a.name, type: a.type, size: a.body.length, base64: Buffer.from(a.body).toString("base64") })),
      }));
      return send(200, { items: out });
    }
    return send(404, { error: "Not found" });
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    ok({ server, url: `http://127.0.0.1:${addr.port}`, calls });
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.argv[2] || 4790);
  const { url } = await startFakeApp({ port, behave: { calendar: "slow", notes: "broken" }, slowMs: 20000 });
  console.log(`fake compliance apps on ${url}/<app> (mail, drive, chat; calendar is slow, notes is broken)`);
}
