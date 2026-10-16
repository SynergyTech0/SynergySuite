import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.COMPLIANCE_TOKEN = "test-token";

const alice = { email: "alice@example.com", name: "Alice" };
const bob = { email: "bob@example.com", name: "Bob" };
const carol = { email: "carol@example.com", name: "Carol" };

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

function scene(words: string[]) {
  return {
    elements: words.map((text, i) => ({ id: `t${i}`, type: "text", x: 0, y: i * 50, text, version: 1, isDeleted: false })),
    files: [],
  };
}

describe.skipIf(!url)("boards", async () => {
  const boards = await import("../lib/boards");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const { searchFor } = await import("../lib/search");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const compliance = async (route: { POST: (req: Request) => Promise<Response> }, body: unknown) => {
    const res = await route.POST(
      new Request("http://whiteboard/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("SELECT 1");
    await q("TRUNCATE boards CASCADE");
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("keeps a board private to its owner until it is shared", async () => {
    const b = await boards.createBoard(alice, { title: "Roadmap" });
    expect(b).toMatchObject({ title: "Roadmap", owner: alice.email, role: "owner", linkAccess: "none", shared: false, pendingTemplate: false });
    await expect(boards.getBoard(bob, b.id)).rejects.toThrow(/Not found/);
    await expect(boards.share(bob, b.id, carol.email, "editor")).rejects.toThrow(/Not found/);
    expect((await boards.listBoards(bob)).map((x) => x.id)).not.toContain(b.id);

    await boards.share(alice, b.id, bob.email, "viewer");
    expect((await boards.getBoard(bob, b.id)).role).toBe("viewer");
    await expect(boards.updateBoard(bob, b.id, { title: "Mine" })).rejects.toThrow(/only view/);
    await expect(boards.setThumbnail(bob, b.id, "data:image/png;base64,AAAA")).rejects.toThrow(/only view/);
    expect((await boards.listBoards(bob)).map((x) => x.id)).toContain(b.id);
    expect((await boards.listBoards(alice))[0].shared).toBe(true);
  });

  it("lets editors bring people in, but only the owner takes editing away or removes people", async () => {
    const b = await boards.createBoard(alice, { title: "Plan" });
    await boards.share(alice, b.id, bob.email, "editor");
    await boards.share(bob, b.id, carol.email, "editor");
    await expect(boards.share(bob, b.id, carol.email, "viewer")).rejects.toThrow(/Only the owner/);
    await expect(boards.unshare(bob, b.id, carol.email)).rejects.toThrow(/owner/);
    await expect(boards.updateBoard(bob, b.id, { linkAccess: "edit" })).rejects.toThrow(/owner/);
    await expect(boards.share(bob, b.id, alice.email, "viewer")).rejects.toThrow(/owner/);
    await boards.share(alice, b.id, carol.email, "viewer");
    expect((await boards.members(alice, b.id)).map((m) => [m.email, m.role])).toEqual([[bob.email, "editor"], [carol.email, "viewer"]]);
    // Anyone can leave a board shared with them.
    await boards.unshare(carol, b.id, carol.email);
    await expect(boards.getBoard(carol, b.id)).rejects.toThrow(/Not found/);
    await expect(boards.share(alice, b.id, "not an email", "editor")).rejects.toThrow(/email/);
    await expect(boards.share(alice, b.id, carol.email, "owner")).rejects.toThrow(/Can view/);
  });

  it("opens a board through its link for anyone signed in, and keeps it in their list", async () => {
    const b = await boards.createBoard(alice, { title: "Open house" });
    await boards.updateBoard(alice, b.id, { linkAccess: "view" });
    expect((await boards.listBoards(carol)).map((x) => x.id)).not.toContain(b.id);
    expect((await boards.getBoard(carol, b.id, { visit: true })).role).toBe("viewer");
    expect((await boards.listBoards(carol)).map((x) => x.id)).toContain(b.id);
    await boards.updateBoard(alice, b.id, { linkAccess: "edit" });
    expect((await boards.getBoard(carol, b.id)).role).toBe("editor");
    await boards.updateBoard(alice, b.id, { linkAccess: "none" });
    await expect(boards.getBoard(carol, b.id)).rejects.toThrow(/Not found/);
    await expect(boards.updateBoard(alice, b.id, { linkAccess: "public" })).rejects.toThrow(/link/);
  });

  it("hands a new board's template to exactly one editor", async () => {
    await expect(boards.createBoard(alice, { title: "X", template: "nope" })).rejects.toThrow(/template/);
    const b = await boards.createBoard(alice, { title: "Retro", template: "retro" });
    expect(b.pendingTemplate).toBe(true);
    await boards.share(alice, b.id, bob.email, "viewer");
    await expect(boards.claimTemplate(bob, b.id)).rejects.toThrow(/only view/);
    const both = await Promise.all([boards.claimTemplate(alice, b.id), boards.claimTemplate(alice, b.id)]);
    expect(both.sort()).toEqual([null, "retro"]);
    expect((await boards.getBoard(alice, b.id)).pendingTemplate).toBe(false);
  });

  it("stores a small picture for the board list", async () => {
    const b = await boards.createBoard(alice, { title: "Pic" });
    await expect(boards.setThumbnail(alice, b.id, "javascript:alert(1)")).rejects.toThrow(/thumbnail/);
    await boards.setThumbnail(alice, b.id, "data:image/png;base64,iVBORw0KGgo=");
    expect((await boards.thumbnail(alice, b.id))?.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect((await boards.getBoard(alice, b.id)).hasThumbnail).toBe(true);
  });

  it("imports a scene into a Yjs document the collaboration server can load", async () => {
    const b = await boards.importBoard(bob, "Imported", scene(["Hello", "World"]));
    expect(b).toMatchObject({ owner: bob.email, elementCount: 2 });
    const [row] = await q<{ ydoc: Buffer; text: string }>("SELECT ydoc, text FROM boards WHERE id = $1", [b.id]);
    expect(row.text).toBe("Hello\nWorld");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.ydoc));
    expect(JSON.parse(doc.getMap<string>("elements").get("t1")!).text).toBe("World");
  });

  it("gives a meeting or chat one board and lets everyone in it edit", async () => {
    const first = await boards.linkedBoard({ source: "chat:42", title: "#design whiteboard", owner: alice.email, people: [alice.email, bob.email] });
    expect(first.created).toBe(true);
    const again = await boards.linkedBoard({ source: "chat:42", title: "ignored", owner: carol.email, people: [carol.email] });
    expect(again).toEqual({ id: first.id, created: false });
    const b = await boards.getBoard(alice, first.id);
    expect(b).toMatchObject({ owner: alice.email, title: "#design whiteboard", source: "chat:42" });
    expect((await boards.getBoard(carol, first.id)).role).toBe("editor");
    // Someone added as a viewer by hand is raised to editor once they are in the channel.
    await boards.share(alice, first.id, "dan@example.com", "viewer");
    await boards.linkedBoard({ source: "chat:42", title: "x", owner: alice.email, people: ["dan@example.com"] });
    expect((await boards.getBoard({ email: "dan@example.com", name: "Dan" }, first.id)).role).toBe("editor");
  });

  it("keeps a board deleted while its owner is on hold, hidden from everyone but eDiscovery", async () => {
    const kept = await boards.importBoard(carol, "Merger notes", scene(["Project Falcon pricing"]));
    const gone = await boards.importBoard(carol, "Scratch", scene(["nothing to see"]));
    await boards.share(carol, kept.id, alice.email, "editor");
    await expect(boards.deleteBoard(alice, kept.id)).rejects.toThrow(/owner/);

    await boards.deleteBoard(carol, gone.id);
    expect(await q("SELECT 1 FROM boards WHERE id = $1", [gone.id])).toHaveLength(0);

    held.add(carol.email);
    await boards.deleteBoard(carol, kept.id);
    held.delete(carol.email);
    await expect(boards.getBoard(carol, kept.id)).rejects.toThrow(/Not found/);
    expect((await boards.listBoards(alice)).map((b) => b.id)).not.toContain(kept.id);
    expect((await searchFor(alice, { query: "falcon" })).results).toEqual([]);

    const found = (await compliance(searchRoute, { query: "falcon", custodians: [alice.email] })) as SearchResponse;
    expect(found.hits).toMatchObject([{ id: kept.id, kind: "board", owner: carol.email, deleted: true, participants: [alice.email] }]);
    const out = (await compliance(exportRoute, { ids: [kept.id, "not-a-uuid"] })) as { items: { id: string; text: string; attachments: { name: string; base64: string }[] }[] };
    expect(out.items).toHaveLength(1);
    expect(out.items[0].text).toContain("Project Falcon pricing");
    const file = JSON.parse(Buffer.from(out.items[0].attachments[0].base64, "base64").toString());
    expect(out.items[0].attachments[0].name).toBe("Merger notes.excalidraw");
    expect(file).toMatchObject({ type: "excalidraw", elements: [{ text: "Project Falcon pricing" }] });
  });

  it("answers suite search with the boards the person can open", async () => {
    const mine = await boards.importBoard(alice, "Launch checklist", scene(["Book the venue"]));
    const others = await boards.importBoard(bob, "Bob's venue ideas", scene(["venue"]));
    const ids = (await searchFor(alice, { query: "venue" })).results.map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(others.id);
    const [hit] = (await searchFor(alice, { query: "checklist" })).results;
    expect(hit).toMatchObject({ id: mine.id, kind: "board", url: `/b/${mine.id}`, person: alice.email });
    expect((await searchFor(alice, { query: "venue", kinds: ["message"] })).results).toEqual([]);
  });
});
