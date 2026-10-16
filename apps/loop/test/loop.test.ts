import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";
import type { SearchResults } from "@synergy/search";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.COMPLIANCE_TOKEN = "test-token";

const me = (email: string) => ({ email, name: email.split("@")[0] });
const alice = me("alice@example.com");
const bob = me("bob@example.com");
const carol = me("carol@example.com");
const dan = me("dan@example.com");

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!url)("loop", async () => {
  const loop = await import("../lib/loop");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const { searchFor } = await import("../lib/search");
  const access = await import("../lib/access.mjs");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const compliance = async (route: { POST: (r: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://loop/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const setText = (table: "pages" | "components", id: string, text: string) => q(`UPDATE ${table} SET text = $2 WHERE id = $1`, [id, text]);

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("SELECT 1");
    await q("TRUNCATE workspaces, components, visits CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  let ws: { id: string; pageId: string };

  it("makes a workspace with a first page, shared with the people added to it", async () => {
    ws = await loop.createWorkspace(alice, { name: "Launch", emoji: "🚀" });
    expect((await loop.listWorkspaces(alice)).map((w) => [w.name, w.role, w.pages])).toEqual([["Launch", "owner", 1]]);
    expect(await loop.listWorkspaces(bob)).toEqual([]);
    await expect(loop.getWorkspace(bob, ws.id)).rejects.toThrow(/don't have access/);

    await loop.addWorkspaceMember(alice, ws.id, { email: "Bob@Example.com", role: "editor" });
    await loop.addWorkspaceMember(alice, ws.id, { email: carol.email, role: "viewer" });
    const w = await loop.getWorkspace(bob, ws.id);
    expect(w.role).toBe("editor");
    expect(w.members.map((m) => `${m.email}:${m.role}`)).toEqual(["alice@example.com:owner", "bob@example.com:editor", "carol@example.com:viewer"]);
    await expect(loop.addWorkspaceMember(bob, ws.id, { email: alice.email })).rejects.toThrow(/owns this workspace/);
  });

  it("lets viewers read but not change, and only the owner remove others", async () => {
    await expect(loop.createPage(carol, { workspaceId: ws.id, title: "Mine" })).rejects.toThrow(/can view/);
    await expect(loop.updatePage(carol, ws.pageId, { title: "x" })).rejects.toThrow(/can view/);
    expect((await loop.getPage(carol, ws.pageId)).role).toBe("viewer");
    await expect(loop.removeWorkspaceMember(bob, ws.id, carol.email)).rejects.toThrow(/Only the owner/);
    await expect(loop.deleteWorkspace(bob, ws.id)).rejects.toThrow(/Only the owner/);
    // The collaboration server applies the same rules to each connection.
    expect(await access.documentRole(q, `page:${ws.pageId}`, carol.email)).toBe("viewer");
    expect(await access.documentRole(q, `page:${ws.pageId}`, dan.email)).toBeNull();
    expect(await access.documentRole(q, "page:not-a-uuid", alice.email)).toBeNull();
  });

  it("nests pages and refuses to put a page under itself", async () => {
    const child = await loop.createPage(bob, { workspaceId: ws.id, parentId: ws.pageId, title: "Notes" });
    const grandchild = await loop.createPage(bob, { workspaceId: ws.id, parentId: child.id, title: "Day 1" });
    expect(child.position).toBe(0);
    await expect(loop.updatePage(alice, ws.pageId, { parentId: grandchild.id })).rejects.toThrow(/under itself/);
    await expect(loop.updatePage(alice, ws.pageId, { parentId: ws.pageId })).rejects.toThrow(/under itself/);
    const other = await loop.createWorkspace(alice, { name: "Other" });
    await expect(loop.updatePage(alice, grandchild.id, { parentId: other.pageId })).rejects.toThrow(/isn't in this workspace/);
    await loop.updatePage(alice, grandchild.id, { parentId: null, title: "Day one" });
    const pages = (await loop.getWorkspace(alice, ws.id)).pages;
    expect(pages.find((p) => p.id === grandchild.id)).toMatchObject({ parent_id: null, title: "Day one", modified_by: alice.email });
    await loop.deletePage(alice, child.id);
    expect((await loop.getWorkspace(alice, ws.id)).pages.map((p) => p.title).sort()).toEqual(["Day one", "Untitled page"]);
    await loop.deleteWorkspace(alice, other.id);
  });

  it("gives a component its own access: owner, people, home workspace and the organization link", async () => {
    const poll = await loop.createComponent(bob, { kind: "voting", workspaceId: ws.id });
    expect(poll).toMatchObject({ title: "Voting table", owner: bob.email, link_access: "org-edit", workspace_name: "Launch" });
    // Anyone in the organization with the link can edit by default.
    expect(await loop.componentRole(poll.id, dan.email)).toBe("editor");
    expect(await loop.componentRole(poll.id, alice.email)).toBe("editor");
    await expect(loop.updateComponent(alice, poll.id, { linkAccess: "people" })).rejects.toThrow(/Only the owner/);
    await loop.updateComponent(bob, poll.id, { linkAccess: "people" });
    expect(await loop.componentRole(poll.id, dan.email)).toBeNull();
    expect(await loop.componentRole(poll.id, carol.email)).toBe("viewer"); // a viewer in its workspace
    await loop.addComponentMember(bob, poll.id, { email: dan.email, role: "viewer" });
    expect(await loop.componentRole(poll.id, dan.email)).toBe("viewer");
    await loop.updateComponent(bob, poll.id, { linkAccess: "org-view" });
    expect(await loop.componentRole(poll.id, me("erin@example.com").email)).toBe("viewer");
    await expect(loop.createComponent(carol, { kind: "tasks", workspaceId: ws.id })).rejects.toThrow(/can view/);
    await expect(loop.createComponent(alice, { kind: "spreadsheet" })).rejects.toThrow(/Pick a kind/);
    await expect(loop.deleteComponent(alice, poll.id)).rejects.toThrow(/Only the owner/);
  });

  it("starts a task list with the rows it is given", async () => {
    const t = await loop.createComponent(alice, {
      kind: "tasks",
      title: "Action items",
      items: [{ title: "Book venue", assignee: "bob@example.com", due: "2026-11-01" }, { title: "" }, { title: "Order food", due: "soon" }],
    });
    const [row] = await q<{ ydoc: Buffer }>("SELECT ydoc FROM components WHERE id = $1", [t.id]);
    expect(loop.ydoc.storedText(row.ydoc, "tasks").text).toBe("[ ] Book venue (bob@example.com, 2026-11-01)\n[ ] Order food");
  });

  it("lists recent pages and components the person can still open", async () => {
    const note = await loop.createComponent(alice, { kind: "note", title: "Standup notes" });
    await loop.getComponent(dan, note.id); // reached through the organization link
    await loop.getPage(alice, ws.pageId);
    expect((await loop.recent(dan)).map((r) => r.title)).toEqual(["Standup notes"]);
    expect((await loop.recent(alice)).map((r) => r.kind)).toContain("page");
    await loop.updateComponent(alice, note.id, { linkAccess: "people" });
    expect(await loop.recent(dan)).toEqual([]);
    // Shown on a page the person is already on: not counted as opening it.
    const quiet = await loop.createComponent(alice, { kind: "checklist", title: "Quiet" });
    await loop.getComponent(bob, quiet.id, true);
    expect((await loop.recent(bob)).map((r) => r.title)).not.toContain("Quiet");
  });

  it("finds pages and components in suite search only for people who can open them", async () => {
    await setText("pages", ws.pageId, "Agenda: pick the launch venue");
    const tracker = await loop.createComponent(bob, { kind: "progress", title: "Venue tracker" });
    await setText("components", tracker.id, "Venue: In progress");
    const titles = async (who: typeof alice) =>
      ((await searchFor(who, { query: "venue" })) as SearchResults).results.map((r) => `${r.kind}:${r.title}`).sort();
    expect(await titles(alice)).toEqual(["page:Untitled page"]);
    expect(await titles(bob)).toEqual(["component:Venue tracker", "page:Untitled page"]);
    // Dan could open the tracker by link, but nobody gave it to him and he hasn't opened it.
    expect(await titles(dan)).toEqual([]);
    await loop.getComponent(dan, tracker.id);
    expect(await titles(dan)).toEqual(["component:Venue tracker"]);
    const [hit] = (await searchFor(bob, { query: "agenda", kinds: ["page"], text: true })).results;
    expect(hit).toMatchObject({ url: `/w/${ws.id}?page=${ws.pageId}`, person: alice.email });
    expect(hit.text).toContain("Page in Launch");
  });

  it("answers the Admin center's eDiscovery searches and exports", async () => {
    expect((await compliance(searchRoute, {}, null)).status).toBe(401);
    const res = await compliance(searchRoute, { query: "venue", custodians: [carol.email] });
    const body = (await res.json()) as SearchResponse;
    // Carol is in the workspace, so its page is hers too; the tracker isn't.
    expect(body.hits.map((h) => `${h.kind}:${h.title}`)).toEqual(["page:Untitled page"]);
    const all = (await (await compliance(searchRoute, { query: "venue" })).json()) as SearchResponse;
    expect(all.total).toBe(2);
    const exp = await (await compliance(exportRoute, { ids: all.hits.map((h) => h.id) })).json();
    expect(exp.items.map((i: { metadata: Record<string, unknown> }) => Object.keys(i.metadata).includes("workspace") || i.metadata.componentKind)).toEqual(
      all.hits.map((h) => (h.kind === "page" ? true : "Progress tracker")),
    );
  });

  it("keeps what is deleted while someone on it is on hold", async () => {
    const page = await loop.createPage(alice, { workspaceId: ws.id, title: "Held page" });
    await setText("pages", page.id, "confidential pricing");
    held.add(carol.email);
    expect(await loop.deletePage(alice, page.id)).toEqual({ kept: true });
    expect((await loop.getWorkspace(alice, ws.id)).pages.map((p) => p.title)).not.toContain("Held page");
    await expect(loop.getPage(alice, page.id)).rejects.toThrow(/isn't there/);
    const found = (await (await compliance(searchRoute, { query: "pricing" })).json()) as SearchResponse;
    expect(found.hits).toMatchObject([{ title: "Held page", deleted: true }]);

    const c = await loop.createComponent(carol, { kind: "qa" });
    expect(await loop.deleteComponent(carol, c.id)).toEqual({ kept: true });
    expect(await loop.componentRole(c.id, carol.email)).toBeNull();
    held.clear();
    const c2 = await loop.createComponent(carol, { kind: "qa" });
    expect(await loop.deleteComponent(carol, c2.id)).toEqual({ kept: false });
    expect((await q("SELECT 1 FROM components WHERE id = $1", [c2.id])).length).toBe(0);
  });
});
