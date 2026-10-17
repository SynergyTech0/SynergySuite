import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.GROUPS_MAIL_DOMAIN = "example.com";
process.env.CAL_SVC_TOKEN = "cal-token";
process.env.PROXY_SHARED_SECRET = "proxy-secret";

const ann = { email: "ann@example.com", name: "Ann", subject: "ann" }; // owner
const bob = { email: "bob@example.com", name: "Bob", subject: "bob" };
const cat = { email: "cat@example.com", name: "Cat", subject: "cat" };

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

describe.skipIf(!url)("groups", async () => {
  const groups = await import("../lib/groups");
  const sync = await import("../lib/sync");
  const svc = await import("../lib/svc");
  const space = await import("../lib/space");
  const { searchFor } = await import("../lib/search");
  const ediscovery = await import("../lib/ediscovery");
  const { parseSearch } = await import("../lib/compliance");
  const { q, db } = await import("../lib/db");

  let calls: Call[] = [];
  let fail: string | null = null;
  sync.setAppFetch((async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    const call: Call = { method: init?.method ?? "GET", url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    if (fail && u.includes(fail)) return new Response(JSON.stringify({ error: "down for maintenance" }), { status: 503 });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (u.includes("/api/svc/teams/") && call.method === "PUT") {
      const b = call.body as { channels: { key: string; name: string }[] };
      return ok({ workspaceId: 7, url: "https://chat.x/?ws=7", channels: b.channels.map((c, i) => ({ key: c.key, id: i + 1, name: c.name, url: `https://chat.x/?ws=7&channel=${i + 1}` })) });
    }
    if (u.includes("/api/svc/teams/") && u.includes("/activity")) return ok({ messages: [{ id: 1, channelKey: "general", channelName: "general", author: { email: bob.email, name: "Bob" }, body: "hi", createdAt: new Date().toISOString(), replyCount: 0, url: "u" }] });
    if (u.includes("/api/svc/libraries/") && call.method === "PUT") return ok({ id: "lib-1", url: "https://drive.x/?library=lib-1" });
    if (u.includes("/api/svc/group-calendars/") && call.method === "PUT") return ok({ source: "s", url: "https://calendar.x/" });
    if (u.includes("/api/svc/groups/") && call.method === "PUT") return ok({ address: decodeURIComponent(u.split("/").pop()!), provisioned: true });
    return ok({ ok: true });
  }) as typeof fetch);

  beforeAll(async () => {
    await q("SELECT 1");
    await q("TRUNCATE groups CASCADE");
  });
  afterAll(async () => {
    sync.setAppFetch(undefined);
    await db().close();
  });

  let teamId = "";
  let dlId = "";

  it("creates a team with its maker as owner, a General channel and an address", async () => {
    teamId = await groups.createGroup(ann, { kind: "team", name: "Sales Team", members: "bob@example.com" });
    const g = await groups.getGroup(ann, teamId);
    expect(g.role).toBe("owner");
    expect(g.email).toBe("sales-team@example.com");
    expect(g.channels.map((c) => c.key)).toEqual(["general"]);
    expect(g.directMembers.map((m) => [m.member, m.role])).toEqual([[ann.email, "owner"], [bob.email, "member"]]);
    expect((await groups.getGroup(bob, teamId)).role).toBe("member");
    await expect(groups.getGroup(cat, teamId)).rejects.toThrow(/Not found/);
    // A second team with the same name gets the next free address.
    const other = await groups.createGroup(cat, { kind: "team", name: "Sales Team" });
    expect((await groups.getGroup(cat, other)).email).toBe("sales-team-2@example.com");
    await expect(groups.createGroup(ann, { kind: "shared_mailbox", name: "Help", alias: "sales-team" })).rejects.toThrow(/already/);
  });

  it("pushes a team to Chat, Drive, Calendar and Mail and records each", async () => {
    calls = [];
    await sync.syncGroup(teamId);
    const chat = calls.find((c) => c.url.includes("/api/svc/teams/"))!;
    expect(chat.method).toBe("PUT");
    expect(chat.url).toBe(`http://localhost:3080/api/svc/teams/groups:${teamId}`);
    expect(chat.headers["x-proxy-auth-secret"]).toBe("proxy-secret");
    expect(chat.body).toMatchObject({ name: "Sales Team", members: [{ email: ann.email, role: "owner" }, { email: bob.email, role: "member" }], channels: [{ key: "general", name: "General" }] });
    const drive = calls.find((c) => c.url.includes("/api/svc/libraries/"))!;
    expect(drive.body).toMatchObject({ members: [{ email: ann.email, role: "owner" }, { email: bob.email, role: "editor" }] });
    const cal = calls.find((c) => c.url.includes("/api/svc/group-calendars/"))!;
    expect(cal.headers.authorization).toBe("Bearer cal-token");
    const mail = calls.find((c) => c.url.includes("/api/svc/groups/"))!;
    expect(mail.body).toMatchObject({ kind: "shared", members: [ann.email, bob.email] });
    const g = await groups.getGroup(ann, teamId);
    expect(g.resources.map((r) => [r.app, r.status])).toEqual([["calendar", "ok"], ["chat", "ok"], ["drive", "ok"], ["mail", "ok"]]);
    expect(g.channels[0].url).toBe("https://chat.x/?ws=7&channel=1");
    expect(g.syncedAt).not.toBeNull();
  });

  it("records an app that is down without stopping the others", async () => {
    fail = "/api/svc/libraries/";
    await sync.syncGroup(teamId);
    fail = null;
    const g = await groups.getGroup(ann, teamId);
    const drive = g.resources.find((r) => r.app === "drive")!;
    expect(drive.status).toBe("error");
    expect(drive.error).toMatch(/down for maintenance/);
    expect(drive.url).toBe("https://drive.x/?library=lib-1"); // last good link kept
    expect(g.resources.find((r) => r.app === "chat")!.status).toBe("ok");
    expect((await groups.getGroup(bob, teamId)).resources.find((r) => r.app === "drive")!.error).toBe(""); // members don't see errors
  });

  it("only owners change a group, and a group keeps an owner", async () => {
    await expect(groups.updateGroup(bob, teamId, { name: "Mine" })).rejects.toThrow(/owners/);
    await expect(groups.addMembers(bob, teamId, "cat@example.com")).rejects.toThrow(/owners/);
    await expect(groups.removeMember(ann, teamId, ann.email)).rejects.toThrow(/at least one owner/);
    await expect(groups.setRole(ann, teamId, ann.email, "member")).rejects.toThrow(/at least one owner/);
    await groups.setRole(ann, teamId, bob.email, "owner");
    await groups.setRole(bob, teamId, ann.email, "member");
    expect(await groups.standing(ann.email, teamId)).toBe("member");
    await groups.setRole(bob, teamId, ann.email, "owner");
    await groups.setRole(ann, teamId, bob.email, "member");
  });

  it("nests groups, flattens them and refuses loops", async () => {
    dlId = await groups.createGroup(cat, { kind: "distribution", name: "Everyone", alias: "everyone", members: ["outside@gmail.com"], allowExternal: true });
    // Cat can't add a private team she can't see.
    await expect(groups.addMembers(cat, dlId, `group:${teamId}`)).rejects.toThrow(/isn't there/);
    await groups.addMembers(ann, teamId, cat.email);
    await groups.addMembers(cat, dlId, `group:${teamId}`);
    expect(await groups.flatMembers(dlId)).toEqual([ann.email, bob.email, cat.email, "outside@gmail.com"]);
    const bobs = await groups.membershipsOf(bob.email);
    expect(bobs.map((m) => [m.name, m.role]).sort()).toEqual([["Everyone", "member"], ["Sales Team", "member"]]);
    await expect(groups.addMembers(ann, teamId, `group:${dlId}`)).rejects.toThrow(/already includes/);
    await expect(groups.addMembers(cat, dlId, `group:${dlId}`)).rejects.toThrow(/itself/);
    await expect(groups.addMembers(cat, dlId, `group:${teamId}`, "owner")).rejects.toThrow(/people/);
    expect(await groups.parentsOf(teamId)).toEqual([dlId]);
  });

  it("re-pushes the lists that hold a team when the team changes", async () => {
    await groups.addMembers(ann, teamId, "dan@example.com");
    calls = [];
    await sync.syncGroup(teamId);
    const list = calls.find((c) => c.url.includes("/api/svc/groups/everyone%40example.com"))!;
    expect(list.body).toMatchObject({ kind: "list", allowExternalSenders: true });
    expect((list.body as { members: string[] }).members).toContain("dan@example.com");
  });

  it("moves the mailbox when the address changes", async () => {
    await groups.updateGroup(ann, teamId, { alias: "sales" });
    calls = [];
    await sync.syncGroup(teamId);
    const mail = calls.filter((c) => c.url.includes("/api/svc/groups/"));
    expect(mail[0]).toMatchObject({ method: "DELETE", url: expect.stringContaining("sales-team%40example.com") });
    expect(mail.find((c) => c.method === "PUT" && c.url.includes("sales%40example.com"))).toBeTruthy();
  });

  it("joins public groups, asks private ones, and owners decide", async () => {
    const eve = { email: "eve@example.com", name: "Eve", subject: "eve" };
    expect(await groups.join(eve, teamId, "please")).toEqual({ joined: false });
    expect((await groups.listGroups(eve, "discover")).find((g) => g.id === teamId)).toBeUndefined(); // private
    const asOwner = await groups.getGroup(ann, teamId);
    expect(asOwner.requests.map((r) => r.email)).toEqual([eve.email]);
    await groups.decideRequest(ann, teamId, eve.email, true);
    expect(await groups.standing(eve.email, teamId)).toBe("member");
    await groups.removeMember(eve, teamId, eve.email);
    await groups.updateGroup(ann, teamId, { privacy: "public" });
    expect((await groups.listGroups(eve, "discover")).map((g) => g.id)).toContain(teamId);
    const outside = await groups.getGroup(eve, teamId);
    expect(outside.role).toBeNull();
    expect(outside.directMembers.every((m) => m.role === "owner")).toBe(true);
    expect(outside.resources).toEqual([]);
    expect(await groups.join(eve, teamId)).toEqual({ joined: true });
  });

  it("adds channels to teams only", async () => {
    await groups.addChannel(bob, teamId, "Deals Q4", "Big ones");
    await expect(groups.addChannel(bob, teamId, "deals q4", "")).rejects.toThrow(/already/);
    await expect(groups.addChannel(cat, dlId, "x", "")).rejects.toThrow(/Only teams/);
    calls = [];
    await sync.syncGroup(teamId);
    const chat = calls.find((c) => c.url.includes("/api/svc/teams/"))!;
    expect((chat.body as { channels: { key: string }[] }).channels.map((c) => c.key)).toEqual(["general", "deals-q4"]);
  });

  it("reads and posts through the team space as a member only", async () => {
    const a = await space.activity(bob, teamId);
    expect(a.messages?.[0].body).toBe("hi");
    calls = [];
    await space.post(bob, teamId, "deals-q4", "Signed!");
    expect(calls[0].body).toEqual({ channelKey: "deals-q4", email: bob.email, body: "Signed!" });
    await expect(space.post(bob, teamId, "nope", "x")).rejects.toThrow(/channel/);
    const stranger = { email: "zed@example.com", name: "Zed", subject: "zed" };
    await expect(space.activity(stranger, teamId)).rejects.toThrow(/Not found/);
    calls = [];
    await space.addEvent(bob, teamId, { title: "Pipeline review", startAt: "2026-10-20T15:00:00Z", endAt: "2026-10-20T16:00:00Z" });
    expect(calls[0].body).toMatchObject({ ownerEmail: bob.email, calendar: "group", groupSource: `groups:${teamId}`, title: "Pipeline review" });
    await expect(space.addEvent(bob, teamId, { startAt: "2026-10-20T16:00:00Z", endAt: "2026-10-20T15:00:00Z" })).rejects.toThrow(/start/);
    fail = "/activity";
    expect(await space.activity(bob, teamId)).toMatchObject({ messages: [], error: expect.stringMatching(/maintenance/) });
    fail = null;
  });

  it("answers other apps: memberships, members and linked sites", async () => {
    const m = await svc.memberships(" Bob@Example.com ");
    expect(m.groups.map((g) => g.id).sort()).toEqual([dlId, teamId].sort());
    const d = await svc.detail(teamId);
    expect(d.owners).toEqual([ann.email]);
    expect(d.members).toContain(bob.email);
    await svc.registerResource(teamId, { app: "sites", ref: "site-9", name: "Sales site", url: "https://sites.x/s/9" });
    await expect(svc.registerResource(teamId, { app: "chat", url: "https://x" })).rejects.toThrow(/Bad app/);
    await expect(svc.registerResource(teamId, { app: "sites", url: "javascript:alert(1)" })).rejects.toThrow(/http/);
    expect((await groups.getGroup(bob, teamId)).resources.find((r) => r.app === "sites")?.url).toBe("https://sites.x/s/9");
  });

  it("finds groups in suite search without showing private ones to outsiders", async () => {
    const priv = await groups.createGroup(ann, { kind: "security", name: "Finance approvers" });
    const asBob = await searchFor(bob, { query: "finance" });
    expect(asBob.results).toEqual([]);
    const asAnn = await searchFor(ann, { query: "finance" });
    expect(asAnn.results.map((r) => r.id)).toEqual([priv]);
    expect(asAnn.results[0].url).toBe(`/g/${priv}`);
    expect((await groups.getGroup(ann, priv)).email).toBeNull();
  });

  it("deletes, removes from every app, and restores", async () => {
    await expect(groups.deleteGroup(bob, teamId)).rejects.toThrow(/owners/);
    await groups.deleteGroup(ann, teamId);
    calls = [];
    await sync.syncGroup(teamId);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname).sort()).toEqual([
      `/api/svc/group-calendars/groups:${teamId}`,
      "/api/svc/groups/sales%40example.com",
      `/api/svc/libraries/groups:${teamId}`,
      `/api/svc/teams/groups:${teamId}`,
    ]);
    // Deleted teams no longer count, even through the list that held them.
    expect(await groups.flatMembers(dlId)).not.toContain(bob.email);
    expect((await svc.memberships(bob.email)).groups.map((g) => g.id)).toEqual([dlId].filter(() => false));
    expect((await groups.listGroups(ann, "deleted")).map((g) => g.id)).toEqual([teamId]);
    expect(await groups.listGroups(bob, "deleted")).toEqual([]);
    await groups.restoreGroup(ann, teamId);
    calls = [];
    await sync.syncGroup(teamId);
    expect(calls.filter((c) => c.method === "PUT").length).toBe(4 + 1); // the team's four apps, then the list that holds it
  });

  it("answers the Admin center's eDiscovery with groups and their history", async () => {
    const res = await ediscovery.search(parseSearch({ query: "sales", custodians: [bob.email] }, ediscovery.KINDS));
    expect(res.hits.some((h) => h.id === teamId && h.kind === "group")).toBe(true);
    const changes = await ediscovery.search(parseSearch({ query: "deleted", kinds: ["group-change"] }, ediscovery.KINDS));
    expect(changes.hits.length).toBeGreaterThan(0);
    const out = await ediscovery.exportItems([teamId, changes.hits[0].id]);
    expect(out.items.length).toBe(2);
    expect((out.items[0].metadata as { members: unknown[] }).members.length).toBeGreaterThan(1);
  });
});
