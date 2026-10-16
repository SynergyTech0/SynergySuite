import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

// Starts the real collaboration server against a Postgres of its own next to TEST_DATABASE_URL
// ("<name>_collab") and connects to it as different people, the way browsers behind the gateway do.
const base = process.env.TEST_DATABASE_URL;
const PORT = 37311;

async function ownDatabase(url: string): Promise<string> {
  const { createDb } = await import("@synergy/db");
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_collab`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

/** A WebSocket that arrives with the gateway's identity header for `email`. */
function socketAs(email: string) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { "x-auth-request-email": email } });
    }
  };
}

function connect(name: string, email: string) {
  const doc = new Y.Doc();
  let refused = false;
  const provider = new HocuspocusProvider({
    websocketProvider: new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${PORT}`, WebSocketPolyfill: socketAs(email) }),
    name,
    document: doc,
    onAuthenticationFailed: () => {
      refused = true;
    },
    onClose: ({ event }) => {
      if (event.code === 4403 || /forbidden|unauth/i.test(event.reason)) refused = true;
    },
  } as ConstructorParameters<typeof HocuspocusProvider>[0]);
  return { doc, provider, refused: () => refused };
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}

describe.skipIf(!base)("live collaboration", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const loop = await import("../lib/loop");
  const { q, db } = await import("../lib/db");
  const { itemsOf, newItem } = await import("../lib/ydoc.mjs");
  const alice = { email: "alice@example.com", name: "Alice" };
  let server: ChildProcess;
  let ws: { id: string; pageId: string };
  let tasks: { id: string };
  const open: { provider: HocuspocusProvider }[] = [];
  const SLOW = 30_000;

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE workspaces, components, visits CASCADE");
    ws = await loop.createWorkspace(alice, { name: "Launch" });
    await loop.addWorkspaceMember(alice, ws.id, { email: "bob@example.com", role: "editor" });
    await loop.addWorkspaceMember(alice, ws.id, { email: "carol@example.com", role: "viewer" });
    tasks = await loop.createComponent(alice, { kind: "tasks", workspaceId: ws.id });
    await loop.updateComponent(alice, tasks.id, { linkAccess: "people" });
    server = spawn(process.execPath, [path.join(import.meta.dirname, "../server/collab.mjs")], {
      env: { ...process.env, COLLAB_PORT: String(PORT), PROXY_SHARED_SECRET: "", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve) => server.stdout!.on("data", (d) => String(d).includes("collaboration server") && resolve()));
  });
  afterAll(async () => {
    for (const c of open) c.provider.destroy();
    server?.kill();
    await db().close();
  });

  const join = (name: string, email: string) => {
    const c = connect(name, email);
    open.push(c);
    return c;
  };

  it("shares every change between the people on a component and saves it with its text", async () => {
    const a = join(`component:${tasks.id}`, "alice@example.com");
    const b = join(`component:${tasks.id}`, "bob@example.com");
    await until(() => a.provider.isSynced && b.provider.isSynced);
    a.doc.getArray("items").push([newItem("tasks", { title: "Book the venue", assignee: "bob@example.com" })]);
    await until(() => itemsOf(b.doc).length === 1);
    expect(itemsOf(b.doc)[0]).toMatchObject({ title: "Book the venue", done: false });
    b.doc.transact(() => (b.doc.getArray("items").get(0) as Y.Map<unknown>).set("done", true));
    await until(() => itemsOf(a.doc)[0]?.done === true);
    await until(async () => {
      const [row] = await q<{ text: string; modified_by: string }>("SELECT text, modified_by FROM components WHERE id = $1", [tasks.id]);
      return row.text === "[x] Book the venue (bob@example.com)";
    }, 15000);
  }, SLOW);

  it("connects viewers read-only and refuses everyone else", async () => {
    const watcher = join(`component:${tasks.id}`, "alice@example.com");
    const carol = join(`component:${tasks.id}`, "carol@example.com");
    await until(() => carol.provider.isSynced && watcher.provider.isSynced);
    expect(itemsOf(carol.doc)).toHaveLength(1);
    carol.doc.getArray("items").push([newItem("tasks", { title: "Sneaky" })]);
    await new Promise((r) => setTimeout(r, 600));
    expect(itemsOf(watcher.doc).map((t) => t.title)).toEqual(["Book the venue"]);

    const dan = join(`component:${tasks.id}`, "dan@example.com");
    await until(() => dan.refused());
    expect(dan.provider.isSynced).toBe(false);
    const nobody = join(`page:${ws.pageId}`, "");
    await until(() => nobody.refused());
    const bogus = join("page:../../etc", "alice@example.com");
    await until(() => bogus.refused());
  }, SLOW);

  it("saves page text and the components placed on it", async () => {
    const p = join(`page:${ws.pageId}`, "bob@example.com");
    await until(() => p.provider.isSynced);
    p.doc.transact(() => {
      const frag = p.doc.getXmlFragment("default");
      const para = new Y.XmlElement("paragraph");
      const t = new Y.XmlText();
      t.insert(0, "Kickoff agenda");
      para.insert(0, [t]);
      const embed = new Y.XmlElement("loopComponent");
      embed.setAttribute("componentId", tasks.id);
      frag.insert(frag.length, [para, embed]);
    });
    await until(async () => {
      const [row] = await q<{ text: string; embeds: string[]; modified_by: string }>("SELECT text, embeds, modified_by FROM pages WHERE id = $1", [ws.pageId]);
      return row.text === "Kickoff agenda" && row.embeds.includes(tasks.id) && row.modified_by === "bob@example.com";
    }, 15000);
  }, SLOW);
});
