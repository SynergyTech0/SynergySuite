import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Me } from "../lib/types";
import { startFakeGraph, type FakeGraph } from "./fake-graph";
import { msg, seed } from "./graph-seed";

/**
 * The whole move against the real suite apps: the fake Microsoft 365 tenant is copied into a
 * running Mail (on a real Stalwart), Drive, Calendar, Contacts and To Do through their normal
 * APIs with the gateway headers, then synced again after changes at the source.
 * Skipped unless MIGRATION_E2E_APP_URLS is set, e.g.
 *   {"mail":"http://127.0.0.1:4320","drive":"http://127.0.0.1:4318","calendar":"http://127.0.0.1:4313",
 *    "contacts":"http://127.0.0.1:4319","todo":"http://127.0.0.1:4321"}
 * with PROXY_SHARED_SECRET matching the apps' and TEST_DATABASE_URL for the Admin center.
 */
const urls = process.env.MIGRATION_E2E_APP_URLS;
const dbUrl = process.env.TEST_DATABASE_URL;
if (dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  process.env.ADMIN_DATABASE_URL = dbUrl;
}
const admin: Me = { email: "admin@suite.test", name: "Admin", role: "admin" };
const CLIENT = "11111111-2222-3333-4444-555555555555";

describe.skipIf(!urls || !dbUrl)("moving a tenant into the real suite apps", async () => {
  process.env.MIGRATION_APP_URLS = urls;
  process.env.MIGRATION_MAX_MESSAGE_MB = "1";
  const apps = JSON.parse(urls || "{}") as Record<string, string>;
  const m = await import("../lib/migrate");
  const runner = await import("../lib/migrate/runner");
  const { gatewayHeaders } = await import("../lib/migrate/suite");
  const { q, db } = await import("../lib/db");
  let fake: FakeGraph;
  const run = Date.now().toString(36);
  const alice = `alice-${run}@${process.env.MIGRATION_E2E_DOMAIN || "suite.test"}`;
  const bob = `bob-${run}@${process.env.MIGRATION_E2E_DOMAIN || "suite.test"}`;
  const deps = () => ({ graph: { loginUrl: fake.loginUrl, graphUrl: fake.graphUrl, sleep: async () => {} } });
  let sourceId = "";

  const get = async <T,>(app: string, path: string, who = alice): Promise<T> => {
    const res = await fetch(`${apps[app]}${path}`, { headers: gatewayHeaders({ email: who }) });
    expect(res.status, `${app} ${path}`).toBe(200);
    return (await res.json()) as T;
  };
  type Folder = { path: string; role: string | null; total: number };
  type MsgSum = { subject: string; seen: boolean; flagged: boolean; date: string | null };
  const folders = () => get<{ folders: Folder[] }>("mail", "/api/folders?account=suite").then((r) => r.folders);
  const messages = (folder: string) => get<{ messages: MsgSum[] }>("mail", `/api/messages?account=suite&folder=${encodeURIComponent(folder)}`).then((r) => r.messages);
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await q("SELECT 1");
    fake = await startFakeGraph({ clientId: CLIENT, secret: "e2e-secret" });
    seed(fake.tenant);
    const s = await m.createSource(admin, { kind: "m365", name: `E2E ${run}`, tenantId: "contoso.example", clientId: CLIENT, clientSecret: "e2e-secret" }, deps());
    sourceId = s.id;
    await m.discover(admin, sourceId, deps());
    await m.map(admin, sourceId, [{ extId: "u-alice", target: alice }, { extId: "u-bob", target: bob }]);
  });
  afterAll(async () => {
    await fake?.close();
    await db().close();
  });

  it("copies everything into the apps on the first run", async () => {
    const { queued } = await m.start(admin, sourceId, { extIds: ["u-alice"] });
    await runner.drain(deps());
    const job = await m.getJob(queued[0].id);
    expect(job.status, job.error ?? "").toBe("done");
    expect(job.report.errors).toEqual([]);
    expect(job.report.counts.mail).toMatchObject({ copied: 7, skipped: 1, failed: 0 });

    // Mail: the hierarchy under the Inbox, flags and the original date.
    const f = await folders();
    const inbox = f.find((x) => x.role === "\\Inbox")!;
    const projects = f.find((x) => /Projects$/.test(x.path))!;
    const year = f.find((x) => /Projects.2024$/.test(x.path))!;
    expect(inbox.total).toBe(3);
    expect(projects.path.startsWith("INBOX")).toBe(true);
    expect(year.total).toBe(1);
    expect(f.find((x) => x.role === "\\Sent")!.total).toBe(1);
    expect(f.find((x) => x.path === "Receipts")!.total).toBe(1);
    const inMsgs = await messages(inbox.path);
    expect(inMsgs.find((x) => x.subject === "Welcome")).toMatchObject({ seen: true, flagged: false });
    expect(inMsgs.find((x) => x.subject === "Flagged one")).toMatchObject({ seen: false, flagged: true });

    // Drive: folders, files, original dates.
    type Item = { id: string; name: string; kind: string; modifiedAt: string };
    const root = (await get<{ items: Item[] }>("drive", "/api/items")).items;
    expect(root.map((i) => i.name)).toEqual(["Docs", "a.txt"]);
    expect(root.find((i) => i.name === "a.txt")!.modifiedAt).toBe("2022-06-07T08:09:10.000Z");
    const docs = (await get<{ items: Item[] }>("drive", `/api/items?parent=${root[0].id}`)).items;
    expect(docs.map((i) => i.name)).toEqual(["Sub", "b.txt"]);

    // Calendar, Contacts, To Do.
    type Ev = { title: string; attendees: string[]; start_at: string };
    const evs = await get<Ev[]>("calendar", "/api/events?from=2026-10-01T00:00:00Z&to=2026-12-31T00:00:00Z");
    expect(evs.map((e) => e.title).sort()).toEqual(["Planning", "Standup", "Standup"]);
    expect(evs.find((e) => e.title === "Planning")!.attendees).toEqual([bob, "partner@outside.test"]);
    type Contact = { displayName: string; company: string };
    const cs = await get<Contact[] | { contacts: Contact[] }>("contacts", "/api/contacts");
    const contacts = Array.isArray(cs) ? cs : cs.contacts;
    expect(contacts.map((c) => c.displayName).sort()).toEqual(["Carol Chen", "Front desk", "Sam Supply"]);
    type Task = { title: string; listName: string; important: boolean; repeat: string | null; completedAt: string | null; steps: { title: string; done: boolean }[] };
    const ts = await get<Task[] | { tasks: Task[] }>("todo", `/api/tasks?view=all&today=${today}`);
    const tasks = Array.isArray(ts) ? ts : ts.tasks;
    expect(tasks.map((t) => `${t.listName}: ${t.title}`).sort()).toEqual(["Groceries: Bread", "Groceries: Milk", "Tasks: File taxes"]);
    const taxes = tasks.find((t) => t.title === "File taxes")!;
    expect(taxes).toMatchObject({ important: true, repeat: "weekdays", completedAt: null });
    expect(taxes.steps).toEqual([expect.objectContaining({ title: "Find receipts", done: true }), expect.objectContaining({ title: "Sign", done: false })]);
    expect(tasks.find((t) => t.title === "Milk")!.completedAt).not.toBe(null);
  }, 120_000);

  it("syncs only the changes on the next run, with no duplicates", async () => {
    const t = fake.tenant;
    msg(t, "u-alice", "f-inbox", "m8", "New after the first copy");
    t.put("mail/u-alice/f-inbox", { ...t.get("mail/u-alice/f-inbox", "m3")!, isRead: true });
    t.move("mail/u-alice/f-inbox", "mail/u-alice/f-archive", "m2");
    t.content.set("i-a", Buffer.from("alpha v2"));
    t.put("drive/d-alice", { ...t.get("drive/d-alice", "i-a")!, cTag: "c2", size: 8 });
    t.put("drive/d-alice", { ...t.get("drive/d-alice", "i-b")!, name: "b-renamed.txt" });
    t.remove("drive/d-alice", "i-c");
    t.put("cal/u-alice", { ...t.get("cal/u-alice", "e1")!, subject: "Planning (moved)", changeKey: "k2" });
    t.remove("contacts/u-alice/default", "c2");
    t.put("todo/u-alice/l-gro", { ...t.get("todo/u-alice/l-gro", "t3")!, status: "completed", lastModifiedDateTime: "2026-02-01T00:00:00Z" });

    const [last] = (await m.detail(sourceId)).users.filter((u) => u.extId === "u-alice").map((u) => u.lastJob!);
    const again = await m.rerunJob(admin, last.id);
    await runner.drain(deps());
    const job = await m.getJob(again.id);
    expect(job.status, job.error ?? "").toBe("done");
    expect(job.report.errors).toEqual([]);
    expect(job.report.counts.mail).toEqual({ copied: 1, updated: 2, deleted: 0, skipped: 0, failed: 0 });
    expect(job.report.counts.files).toEqual({ copied: 0, updated: 2, deleted: 1, skipped: 0, failed: 0 });

    const f = await folders();
    const inbox = f.find((x) => x.role === "\\Inbox")!;
    const archive = f.find((x) => x.role === "\\Archive" || /^Archive$/i.test(x.path))!;
    expect(inbox.total).toBe(3); // Welcome, Unread, the new one (Flagged one moved out)
    expect(archive.total).toBe(1);
    expect((await messages(inbox.path)).find((x) => x.subject === "Unread")!.seen).toBe(true);
    expect((await messages(archive.path)).map((x) => x.subject)).toEqual(["Flagged one"]);
    const total = f.reduce((n, x) => n + x.total, 0);
    expect(total).toBe(8);

    type Item = { id: string; name: string; kind: string; version: number };
    const root = (await get<{ items: Item[] }>("drive", "/api/items")).items;
    expect(root.find((i) => i.name === "a.txt")!.version).toBe(2);
    const docs = (await get<{ items: Item[] }>("drive", `/api/items?parent=${root.find((i) => i.name === "Docs")!.id}`)).items;
    expect(docs.map((i) => i.name)).toEqual(["Sub", "b-renamed.txt"]);
    const sub = (await get<{ items: Item[] }>("drive", `/api/items?parent=${docs[0].id}`)).items;
    expect(sub).toEqual([]);

    const evs = await get<{ title: string }[]>("calendar", "/api/events?from=2026-10-01T00:00:00Z&to=2026-12-31T00:00:00Z");
    expect(evs.map((e) => e.title).sort()).toEqual(["Planning (moved)", "Standup", "Standup"]);
    const cs = await get<{ displayName: string }[] | { contacts: { displayName: string }[] }>("contacts", "/api/contacts");
    expect((Array.isArray(cs) ? cs : cs.contacts).length).toBe(2);
    const ts = await get<{ title: string; completedAt: string | null }[] | { tasks: { title: string; completedAt: string | null }[] }>("todo", `/api/tasks?view=all&today=${today}`);
    const tasks = Array.isArray(ts) ? ts : ts.tasks;
    expect(tasks.length).toBe(3);
    expect(tasks.find((x) => x.title === "Bread")!.completedAt).not.toBe(null);
  }, 120_000);

  it("copies a SharePoint site into a Drive shared library its members can open", async () => {
    const { queued } = await m.start(admin, sourceId, { siteIds: ["site-mkt"] });
    await runner.drain(deps());
    const job = await m.getJob(queued[0].id);
    expect(job.status, job.error ?? "").toBe("done");
    expect(job.report.errors).toEqual([]);
    const libs = (await get<{ libraries: { id: string; name: string; role: string }[] }>("drive", "/api/libraries")).libraries;
    const lib = libs.find((l) => l.name === "Marketing")!;
    expect(lib.role).toBe("owner");
    expect((await get<{ items: { name: string }[] }>("drive", `/api/items?library=${lib.id}`, bob)).items.map((i) => i.name)).toEqual(["Plan.docx"]);
    const members = (await get<{ members: { email: string; role: string }[] }>("drive", `/api/libraries/${lib.id}/members`)).members;
    expect(members).toEqual([{ email: admin.email, role: "owner" }, { email: alice, role: "owner" }, { email: bob, role: "editor" }].sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "owner" ? -1 : 1)));
  }, 60_000);

  // MIGRATION_E2E_IMAP="host:port:masterLogin:masterPassword": a Stalwart master login, used to fill and read a source mailbox.
  it.skipIf(!process.env.MIGRATION_E2E_IMAP)("copies a mailbox from another IMAP server, then only what changed", async () => {
    const { ImapFlow } = await import("imapflow");
    const [host, port, masterLogin, masterPass] = process.env.MIGRATION_E2E_IMAP!.split(":");
    process.env.MIGRATION_ALLOW_PRIVATE_HOSTS = "1";
    const oldBox = `old-${run}@${process.env.MIGRATION_E2E_DOMAIN || "suite.test"}`;
    const carol = `carol-${run}@${process.env.MIGRATION_E2E_DOMAIN || "suite.test"}`;
    // The old mailbox exists once Mail has opened it (Stalwart creates it through Mail's provisioning).
    await get("mail", "/api/folders?account=suite", oldBox);
    const login = `${oldBox}%${masterLogin}`;
    const src = async <T,>(fn: (c: InstanceType<typeof ImapFlow>) => Promise<T>) => {
      const c = new ImapFlow({ host, port: Number(port), secure: true, tls: { rejectUnauthorized: false }, auth: { user: login, pass: masterPass }, logger: false });
      await c.connect();
      try { return await fn(c); } finally { await c.logout(); }
    };
    const raw = (subject: string) => Buffer.from(`From: x@old.test\r\nTo: ${oldBox}\r\nSubject: ${subject}\r\nMessage-ID: <${subject.replace(/\W/g, "")}-${run}@old.test>\r\n\r\nHello\r\n`);
    await src(async (c) => {
      const boxes = await c.list();
      const delim = boxes[0]?.delimiter || "/";
      await c.mailboxCreate(`INBOX${delim}Clients`);
      await c.append("INBOX", raw("Old one"), ["\\Seen"], new Date("2020-05-06T07:08:09Z"));
      await c.append("INBOX", raw("Old flagged"), ["\\Flagged"]);
      await c.append(`INBOX${delim}Clients`, raw("Client mail"), ["\\Seen"]);
      await c.append(boxes.find((b) => b.specialUse === "\\Sent")!.path, raw("Sent before"), ["\\Seen"]);
    });
    const s = await m.createSource(admin, { kind: "imap", name: "Old host", host, port: Number(port), secure: true });
    await m.addMailbox(admin, s.id, { login, password: masterPass, target: carol, name: "Carol" });
    const d = await m.discover(admin, s.id);
    expect(d.users[0]).toMatchObject({ mailItems: 4, hasMailbox: true });
    const first = await m.start(admin, s.id, { extIds: [login] });
    await runner.drain(deps());
    let job = await m.getJob(first.queued[0].id);
    expect(job.status, job.error ?? "").toBe("done");
    expect(job.report.counts.mail).toEqual({ copied: 4, updated: 0, deleted: 0, skipped: 0, failed: 0 });
    const f = await get<{ folders: Folder[] }>("mail", "/api/folders?account=suite", carol).then((r) => r.folders);
    const inbox = f.find((x) => x.role === "\\Inbox")!;
    expect(inbox.total).toBe(2);
    expect(f.find((x) => /Clients$/.test(x.path))!.total).toBe(1);
    expect(f.find((x) => x.role === "\\Sent")!.total).toBe(1);
    const msgs = await get<{ messages: MsgSum[] }>("mail", `/api/messages?account=suite&folder=${encodeURIComponent(inbox.path)}`, carol).then((r) => r.messages);
    expect(msgs.find((x) => x.subject === "Old one")).toMatchObject({ seen: true, flagged: false });
    expect(msgs.find((x) => x.subject === "Old flagged")).toMatchObject({ seen: false, flagged: true });

    // A new message and a flag change at the source, then the final sync.
    await src(async (c) => {
      await c.append("INBOX", raw("Arrived later"));
      const lock = await c.getMailboxLock("INBOX");
      try {
        const uids = (await c.search({ subject: "Old flagged" }, { uid: true })) || [];
        await c.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      } finally { lock.release(); }
    });
    const again = await m.rerunJob(admin, job.id);
    await runner.drain(deps());
    job = await m.getJob(again.id);
    expect(job.status, job.error ?? "").toBe("done");
    expect(job.report.counts.mail).toEqual({ copied: 1, updated: 1, deleted: 0, skipped: 0, failed: 0 });
    const after = await get<{ messages: MsgSum[] }>("mail", `/api/messages?account=suite&folder=${encodeURIComponent(inbox.path)}`, carol).then((r) => r.messages);
    expect(after.map((x) => x.subject).sort()).toEqual(["Arrived later", "Old flagged", "Old one"]);
    expect(after.find((x) => x.subject === "Old flagged")!.seen).toBe(true);
  }, 120_000);
});
