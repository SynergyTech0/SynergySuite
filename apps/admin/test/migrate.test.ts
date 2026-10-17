import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Me } from "../lib/types";
import { startFakeGraph, type FakeGraph } from "./fake-graph";
import { msg, seed } from "./graph-seed";
import { FakeSuite } from "./fake-suite";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.ADMIN_DATABASE_URL = url;
}
process.env.ADMIN_EMAILS = "admin@suite.test";
process.env.MIGRATION_ENCRYPTION_KEY = "test-migration-key";
process.env.MIGRATION_MAX_MESSAGE_MB = "1";

const admin: Me = { email: "admin@suite.test", name: "Admin", role: "admin" };
const CLIENT = "11111111-2222-3333-4444-555555555555";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SECRET = "s3cret~value";

/** The sign-in service's SCIM API, as far as People uses it. */
async function startScim(existing: string[]) {
  const users = existing.map((e, i) => ({ id: `s${i}`, userName: e, active: true }));
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    res.setHeader("Content-Type", "application/scim+json");
    if (req.headers.authorization !== "Bearer scim-token") return res.writeHead(401).end("{}");
    if (req.method === "GET") return res.end(JSON.stringify({ totalResults: users.length, Resources: users }));
    const b = JSON.parse(Buffer.concat(chunks).toString());
    const u = { id: `s${users.length}`, userName: b.userName, active: true, name: b.name };
    users.push(u);
    res.writeHead(201).end(JSON.stringify(u));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, users, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe.skipIf(!url)("moving from Microsoft 365", async () => {
  const m = await import("../lib/migrate");
  const runner = await import("../lib/migrate/runner");
  const { Crash } = await import("../lib/migrate/context");
  const { q, db } = await import("../lib/db");

  let fake: FakeGraph;
  let scim: Awaited<ReturnType<typeof startScim>>;
  const suite = new FakeSuite();
  const sleeps: number[] = [];
  const graph = () => ({ loginUrl: fake.loginUrl, graphUrl: fake.graphUrl, sleep: async (ms: number) => void sleeps.push(ms) });
  const deps = () => ({ graph: graph(), suite });
  let sourceId = "";
  const ids = { alice: "u-alice", bob: "u-bob", dave: "u-dave" };

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE migration_sources, migration_users, migration_sites, migration_jobs, migration_cursors, migration_items RESTART IDENTITY CASCADE");
    fake = await startFakeGraph({ clientId: CLIENT, secret: SECRET });
    seed(fake.tenant);
    scim = await startScim(["admin@suite.test", "alice@suite.test"]);
    process.env.ADMIN_SCIM_TOKEN = "scim-token";
    process.env.AUTH_INTERNAL_URL = scim.url;
  });
  afterAll(async () => {
    runner.stopWorker();
    await fake?.close();
    scim?.server.close();
    await db().close();
  });

  it("connects a tenant only with a working client secret, and keeps the secret sealed", async () => {
    await expect(m.createSource(admin, { kind: "m365", tenantId: TENANT, clientId: CLIENT, clientSecret: "wrong" }, deps())).rejects.toThrow(/refused the client secret/);
    await expect(m.createSource(admin, { kind: "m365", tenantId: "not a tenant", clientId: CLIENT, clientSecret: SECRET }, deps())).rejects.toThrow(/tenant/);
    await expect(m.createSource(admin, { kind: "m365", tenantId: TENANT, clientId: "nope", clientSecret: SECRET }, deps())).rejects.toThrow(/client\) ID/);
    const s = await m.createSource(admin, { kind: "m365", name: "Contoso", tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET }, deps());
    sourceId = s.id;
    expect(s.config).toEqual({ tenantId: TENANT, clientId: CLIENT });
    const [row] = await q<{ secret: string }>("SELECT secret FROM migration_sources WHERE id = $1", [s.id]);
    expect(row.secret).toMatch(/^v1\./);
    expect(row.secret).not.toContain(SECRET);
    expect(JSON.stringify(await m.listSources())).not.toContain(SECRET);
    const [log] = await q<{ details: unknown }>("SELECT details FROM audit WHERE action = 'migration.source.create' AND target = $1", [s.id]);
    expect(JSON.stringify(log.details)).not.toContain(SECRET);
  });

  it("discovers people with their mailbox and OneDrive sizes, and SharePoint sites with their members", async () => {
    const d = await m.discover(admin, sourceId, deps());
    expect(d.users.map((u) => u.email)).toEqual(["alice@contoso.test", "bob@contoso.test", "dave@contoso.test"]);
    const alice = d.users.find((u) => u.extId === ids.alice)!;
    expect(alice).toMatchObject({ name: "Alice Adams", mailBytes: 123456, mailItems: 9, hasMailbox: true, hasDrive: true, driveBytes: 19 });
    expect(d.users.find((u) => u.extId === ids.bob)).toMatchObject({ hasDrive: false, mailBytes: 2048 });
    // Alice already has a suite account under her old address? No: alice@suite.test does, so nothing is guessed.
    expect(alice.target).toBe(null);
    expect(d.sites).toEqual([expect.objectContaining({ siteId: "site-mkt", name: "Marketing", driveBytes: 4, libraries: 1, include: false })]);
    expect(d.sites[0].members).toEqual([
      { email: "alice@contoso.test", role: "owner" }, { email: "bob@contoso.test", role: "member" }, { email: "nobody@contoso.test", role: "member" },
    ]);
  });

  it("maps people to suite accounts and creates the missing ones with their mailboxes", async () => {
    await expect(m.map(admin, sourceId, [{ extId: ids.alice, target: "x@suite.test" }, { extId: ids.bob, target: "x@suite.test" }])).rejects.toThrow(/same suite account/);
    const d = await m.map(admin, sourceId, [
      { extId: ids.alice, target: "Alice@suite.test" }, { extId: ids.bob, target: "bob@suite.test" }, { extId: ids.dave, target: "dave@suite.test" },
    ]);
    expect(d.users.map((u) => [u.target, u.targetExists])).toEqual([["alice@suite.test", true], ["bob@suite.test", false], ["dave@suite.test", false]]);
    const r = await m.createAccounts(admin, sourceId, [ids.alice, ids.bob], deps());
    expect(r).toEqual({ created: ["bob@suite.test"], existed: ["alice@suite.test"], failed: [] });
    expect(scim.users.map((u) => u.userName)).toContain("bob@suite.test");
    expect([...suite.provisioned].sort()).toEqual(["alice@suite.test", "bob@suite.test"]);
  });

  it("copies a person's mail, files, calendar, contacts and To Do, waiting out throttling", async () => {
    fake.throttleEvery = 7;
    fake.retryAfter = "3";
    const { queued } = await m.start(admin, sourceId, { extIds: [ids.alice, ids.bob] });
    expect(queued.map((j) => j.target)).toEqual(["alice@suite.test", "bob@suite.test"]);
    expect((await m.start(admin, sourceId, { extIds: [ids.alice] })).skipped).toEqual(["alice@contoso.test: already queued or running"]);
    expect(await runner.drain(deps())).toBe(2);
    fake.throttleEvery = 0;
    expect(fake.throttled).toBeGreaterThan(3);
    expect(sleeps.filter((s) => s === 3000).length).toBe(fake.throttled);

    const job = await m.getJob(queued[0].id);
    expect(job.status).toBe("done");
    expect(job.report.counts.mail).toEqual({ copied: 7, updated: 0, deleted: 0, skipped: 1, failed: 0 });
    expect(job.report.counts.files).toEqual({ copied: 5, updated: 0, deleted: 0, skipped: 1, failed: 0 });
    expect(job.report.counts.calendar).toEqual({ copied: 3, updated: 0, deleted: 0, skipped: 1, failed: 0 });
    expect(job.report.counts.contacts).toEqual({ copied: 3, updated: 0, deleted: 0, skipped: 0, failed: 0 });
    expect(job.report.counts.todo).toEqual({ copied: 3, updated: 0, deleted: 0, skipped: 0, failed: 0 });
    expect(job.report.skipped.map((s) => s.reason)).toEqual([
      "Larger than 1 MB", "OneNote notebook (not migrated yet)", "Meeting organized by someone who also moves to the suite; it shows from their calendar",
    ]);
    expect(job.report.notMigrated).toContain("Teams chats and channel messages");
    expect(job.report.throttled).toBeGreaterThan(0);

    // Mail: the folder tree, read and flag state, the received date.
    const mail = suite.mail.get("alice@suite.test")!;
    expect(mail.map((x) => x.folder).sort()).toEqual(["INBOX", "INBOX", "INBOX", "INBOX/Projects", "INBOX/Projects/2024", "Receipts", "Sent Items"]);
    expect(mail.find((x) => x.raw.includes("Subject: Welcome"))).toMatchObject({ seen: true, flagged: false, date: "2023-01-02T03:04:05Z" });
    expect(mail.find((x) => x.raw.includes("Subject: Flagged one"))).toMatchObject({ seen: false, flagged: true });
    expect(mail.some((x) => x.raw.includes("Teams chat log"))).toBe(false);
    expect(suite.mail.get("bob@suite.test")!.length).toBe(1);

    // Files: the folders, with original dates.
    const files = suite.live("u:alice@suite.test").map((i) => `${suite.pathOf(i)}${i.kind === "folder" ? "/" : ""}`).sort();
    expect(files).toEqual(["Docs/", "Docs/Sub/", "Docs/Sub/c.txt", "Docs/b.txt", "a.txt"]);
    expect(suite.live("u:alice@suite.test").find((i) => i.name === "a.txt")).toMatchObject({ body: "alpha", modifiedAt: "2022-06-07T08:09:10Z" });

    // Calendar: attendees mapped to their suite accounts, the series kept for later.
    const events = [...suite.events.values()].filter((e) => e.owner === "alice@suite.test").map((e) => e.e);
    expect(events.map((e) => e.title).sort()).toEqual(["Planning", "Standup", "Standup"]);
    expect(events.find((e) => e.title === "Planning")).toMatchObject({
      startAt: "2026-11-02T09:00:00.000Z", endAt: "2026-11-02T10:00:00.000Z", description: "About Planning", location: "Room 1", attendees: ["bob@suite.test", "partner@outside.test"],
    });
    const [series] = await q<{ info: { recurrence: { pattern: { type: string } } } }>("SELECT info FROM migration_items WHERE workload = 'calendar-series' AND item_id = 's1'");
    expect(series.info.recurrence.pattern.type).toBe("weekly");

    // Contacts and To Do.
    const contacts = [...suite.contacts.values()].map((c) => c.c);
    expect(contacts.find((c) => c.lastName === "Chen")).toMatchObject({ company: "Fabrikam", birthday: "1990-04-05", phones: [{ label: "mobile", value: "+1 555 0100" }] });
    expect(contacts.find((c) => c.firstName === "Front desk")).toBeTruthy();
    const tasks = [...suite.tasks.values()];
    expect(tasks.find((t) => t.t.title === "File taxes")).toMatchObject({ list: null, t: { important: true, due: "2027-04-15", repeat: "weekdays", notes: "Use the new form", steps: [{ title: "Find receipts", done: true }, { title: "Sign", done: false }] } });
    expect(tasks.find((t) => t.t.title === "Milk")?.t.completed).toBe(true);
    expect(suite.lists.map((l) => l.name)).toEqual(["Groceries"]);
  });

  it("copies a SharePoint site into a shared library with its members", async () => {
    await m.setSite(admin, sourceId, { siteId: "site-mkt", include: true });
    const { queued } = await m.start(admin, sourceId, { siteIds: ["site-mkt"] });
    await runner.drain(deps());
    const job = await m.getJob(queued[0].id);
    expect(job.status).toBe("done");
    expect(job.report.counts.library).toMatchObject({ copied: 1 });
    const lib = suite.libraries.find((l) => l.name === "Marketing")!;
    // Owners and members with suite accounts; nobody@ isn't mapped, so isn't added.
    expect([...lib.members.entries()].sort()).toEqual([["admin@suite.test", "owner"], ["alice@suite.test", "owner"], ["bob@suite.test", "editor"]]);
    expect(suite.live(`l:${lib.id}`).map((i) => i.name)).toEqual(["Plan.docx"]);
  });

  it("resumes a copy where it stopped when the process dies mid-way, without copying anything twice", async () => {
    const { queued } = await m.start(admin, sourceId, { extIds: [ids.dave], workloads: ["mail"] });
    let crashed = false;
    const crashing = { ...deps(), hooks: { afterItem: (_w: string, n: number) => { if (n === 5 && !crashed) { crashed = true; throw new Crash("power cut"); } } } };
    await expect(runner.drain(crashing)).rejects.toThrow("power cut");
    expect((await m.getJob(queued[0].id)).status).toBe("running");
    expect(suite.mail.get("dave@suite.test")!.length).toBe(5);
    // The next start of the Admin center finds it running with no worker, and resumes it.
    expect(await runner.recoverStale(0)).toBe(1);
    expect(await runner.drain(deps())).toBe(1);
    const job = await m.getJob(queued[0].id);
    expect(job.status).toBe("done");
    expect(job.attempts).toBe(2);
    const dave = suite.mail.get("dave@suite.test")!;
    expect(dave.length).toBe(12);
    expect(new Set(dave.map((x) => x.raw)).size).toBe(12);
    expect(job.report.counts.mail?.copied).toBe(12);
  });

  it("tries a run again later when a suite app is down", async () => {
    suite.down.set("mail", 1);
    const { queued } = await m.start(admin, sourceId, { extIds: [ids.bob], workloads: ["mail"] });
    await runner.drain(deps());
    let job = await m.getJob(queued[0].id);
    expect(job.status).toBe("queued");
    expect(job.error).toMatch(/Couldn't reach mail.*trying again/);
    await q("UPDATE migration_jobs SET not_before = now() WHERE id = $1", [job.id]);
    await runner.drain(deps());
    job = await m.getJob(queued[0].id);
    expect(job.status).toBe("done");
    expect(suite.mail.get("bob@suite.test")!.length).toBe(1);
  });

  it("re-runs as a delta sync: only what changed is copied, nothing twice", async () => {
    const t = fake.tenant;
    const writesBefore = suite.writes;
    // Nothing changed: a re-run writes nothing.
    const [aliceJob] = (await m.detail(sourceId)).users.filter((u) => u.extId === ids.alice).map((u) => u.lastJob!);
    const quiet = await m.rerunJob(admin, aliceJob.id);
    await runner.drain(deps());
    expect((await m.getJob(quiet.id)).status).toBe("done");
    expect(suite.writes - writesBefore).toBe(1); // only the mailbox check
    expect(Object.values((await m.getJob(quiet.id)).report.counts).every((c) => c!.copied + c!.updated + c!.deleted === 0)).toBe(true);

    // Changes at the source before cutover.
    msg(t, "u-alice", "f-inbox", "m8", "New after the first copy");
    t.put("mail/u-alice/f-inbox", { ...t.get("mail/u-alice/f-inbox", "m3")!, isRead: true });
    t.move("mail/u-alice/f-inbox", "mail/u-alice/f-archive", "m2");
    t.content.set("i-a", Buffer.from("alpha v2"));
    t.put("drive/d-alice", { ...t.get("drive/d-alice", "i-a")!, cTag: "c2", size: 8 });
    t.put("drive/d-alice", { ...t.get("drive/d-alice", "i-b")!, name: "b-renamed.txt" });
    t.remove("drive/d-alice", "i-c");
    t.put("cal/u-alice", { ...t.get("cal/u-alice", "e1")!, subject: "Planning (moved)", changeKey: "k2" });
    t.remove("cal/u-alice", "e3");
    t.remove("contacts/u-alice/default", "c2");
    t.put("todo/u-alice/l-gro", { ...t.get("todo/u-alice/l-gro", "t3")!, status: "completed", lastModifiedDateTime: "2026-02-01T00:00:00Z" });

    const again = await m.rerunJob(admin, quiet.id);
    await runner.drain(deps());
    const job = await m.getJob(again.id);
    expect(job.status).toBe("done");
    expect(job.report.counts.mail).toEqual({ copied: 1, updated: 2, deleted: 0, skipped: 0, failed: 0 });
    expect(job.report.counts.files).toEqual({ copied: 0, updated: 2, deleted: 1, skipped: 0, failed: 0 });
    expect(job.report.counts.calendar).toEqual({ copied: 0, updated: 1, deleted: 1, skipped: 0, failed: 0 });
    expect(job.report.counts.contacts).toEqual({ copied: 0, updated: 0, deleted: 1, skipped: 0, failed: 0 });
    expect(job.report.counts.todo).toEqual({ copied: 0, updated: 1, deleted: 0, skipped: 0, failed: 0 });

    const mail = suite.mail.get("alice@suite.test")!;
    expect(mail.length).toBe(8);
    expect(new Set(mail.map((x) => x.raw)).size).toBe(8);
    expect(mail.find((x) => x.raw.includes("Subject: Unread"))!.seen).toBe(true);
    expect(mail.find((x) => x.raw.includes("Subject: Flagged one"))!.folder).toBe("archive");
    const files = suite.live("u:alice@suite.test");
    expect(files.map((i) => suite.pathOf(i)).sort()).toEqual(["Docs", "Docs/Sub", "Docs/b-renamed.txt", "a.txt"]);
    expect(files.find((i) => i.name === "a.txt")).toMatchObject({ body: "alpha v2", versions: 2 });
    expect([...suite.events.values()].map((e) => e.e.title).sort()).toEqual(["Planning (moved)", "Standup"]);
    expect([...suite.contacts.values()].length).toBe(2);
    expect([...suite.tasks.values()].find((x) => x.t.title === "Bread")!.t.completed).toBe(true);
  });

  it("cancels a queued copy and refuses to remove a source with copies in flight", async () => {
    const { queued } = await m.start(admin, sourceId, { extIds: [ids.bob] });
    await expect(m.deleteSource(admin, sourceId)).rejects.toThrow(/Cancel/);
    expect((await m.cancelJob(admin, queued[0].id)).status).toBe("cancelled");
    expect(await runner.drain(deps())).toBe(0);
    const csv = m.reportCsv(await m.getJob((await m.detail(sourceId)).jobs.find((j) => j.status === "done" && j.label === "Alice Adams")!.id));
    expect(csv.split("\r\n")[0]).toBe("section,workload,item,detail");
  });
});
