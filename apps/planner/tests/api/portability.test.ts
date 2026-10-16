import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cardLabels, cards, checklistItems, checklists, comments, labels, lists, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST for import, export and copy.
 *
 * An import creates a whole board in one request, which makes it the largest write in the app and the
 * one most likely to land somewhere it should not — so the first thing asserted is that it lands in
 * the caller's own workspace, and the second is that a copy of someone else's board is a 404.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, url = "http://localhost/api") =>
  new Request(url, {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let alice: Tenant;
beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub; identity.email = alice.email;
});
afterAll(async () => { await closeDb(); });

const trelloExport = JSON.stringify({
  name: "From Trello",
  labels: [{ id: "l1", name: "urgent", color: "red" }],
  lists: [{ id: "L1", name: "Inbox", pos: 1, closed: false }, { id: "L2", name: "Shipped", pos: 2, closed: false }],
  cards: [
    { id: "c1", name: "Write the thing", desc: "a body", idList: "L1", pos: 1, closed: false,
      due: "2026-10-05T00:00:00.000Z", dueComplete: false, idLabels: ["l1"] },
    { id: "c2", name: "Shipped thing", desc: "", idList: "L2", pos: 2, closed: false, dueComplete: true, idLabels: [] },
  ],
  checklists: [{ id: "k1", idCard: "c1", name: "Steps", checkItems: [{ name: "one", state: "complete", pos: 1 }] }],
  actions: [{ type: "commentCard", date: "2026-09-01T00:00:00.000Z",
    data: { card: { id: "c1" }, text: "ship it" }, memberCreator: { fullName: "Ann" } }],
});

describe("importing a Trello board", () => {
  it("creates the board in the caller's own workspace, with its lists, cards, labels and checklists", async () => {
    const { POST } = await import("@/app/api/import/route");
    const res = await POST(req("POST", { kind: "trello", text: trelloExport }));
    expect(res.status).toBe(201);
    const body = await res.json();

    const [board] = await db.select().from(boards).where(eq(boards.id, body.boardId));
    expect(board.title).toBe("From Trello");
    expect(board.workspaceId).toBe(alice.workspaceId);

    const cols = await db.select().from(lists).where(eq(lists.boardId, board.id));
    expect(cols.map((l) => l.title).sort()).toEqual(["Inbox", "Shipped"]);

    const made = await db.select().from(cards).where(eq(cards.boardId, board.id));
    expect(made).toHaveLength(2);
    const one = made.find((c) => c.title === "Write the thing")!;
    expect(one.description).toBe("a body");
    expect(one.dueDate?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(one.issueKey).toBeTruthy();                       // imported cards are real issues here

    // A card Trello marked due-complete arrives complete, so the Done column is not a lie.
    expect(made.find((c) => c.title === "Shipped thing")!.isComplete).toBe(true);

    const [lbl] = await db.select().from(labels).where(eq(labels.boardId, board.id));
    expect(lbl.name).toBe("urgent");
    expect(await db.select().from(cardLabels).where(eq(cardLabels.cardId, one.id))).toHaveLength(1);

    const [k] = await db.select().from(checklists).where(eq(checklists.cardId, one.id));
    expect(k.title).toBe("Steps");
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.checklistId, k.id));
    expect(item).toMatchObject({ text: "one", isChecked: true });

    // The comment keeps its author in the text: it was written by someone who is not a user here.
    const [c] = await db.select().from(comments).where(eq(comments.cardId, one.id));
    expect(c.body).toContain("Ann");
    expect(c.body).toContain("ship it");

    expect(body.summary).toMatchObject({ lists: 2, cards: 2 });
  });

  it("makes the importer a member of the board it just created", async () => {
    const { POST } = await import("@/app/api/import/route");
    const { boardId } = await (await POST(req("POST", { kind: "trello", text: trelloExport }))).json();
    const { GET } = await import("@/app/api/boards/[id]/route");
    expect((await GET(req("GET"), ctx(boardId))).status).toBe(200);
  });

  it("rejects a file that is not a Trello export with 400 and the reason", async () => {
    const { POST } = await import("@/app/api/import/route");
    const res = await POST(req("POST", { kind: "trello", text: "{}" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Trello/i);
  });

  it("does not add the caller to a workspace they were only invited to observe", async () => {
    const bob = await seedTenant("bob");
    await db.insert(workspaceMembers).values({ workspaceId: bob.workspaceId, userId: alice.userId, role: "observer" });
    const { POST } = await import("@/app/api/import/route");
    const { boardId } = await (await POST(req("POST", { kind: "trello", text: trelloExport }))).json();
    const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
    expect(board.workspaceId).not.toBe(bob.workspaceId);
  });
});

describe("importing a Jira CSV", () => {
  it("creates one list per status and carries type, priority and points", async () => {
    const csv = "Issue key,Issue Type,Summary,Status,Priority,Story Points\nSYN-1,Bug,Crash,In Progress,Highest,3";
    const { POST } = await import("@/app/api/import/route");
    const res = await POST(req("POST", { kind: "jira", text: csv, title: "Jira board" }));
    expect(res.status).toBe(201);
    const { boardId } = await res.json();
    const [col] = await db.select().from(lists).where(eq(lists.boardId, boardId));
    expect(col.title).toBe("In Progress");
    const [card] = await db.select().from(cards).where(eq(cards.boardId, boardId));
    expect(card).toMatchObject({ title: "Crash", issueType: "bug", priority: "highest", points: 3 });
  });
});

describe("exporting a board as CSV", () => {
  it("writes a row per card with the columns a spreadsheet expects", async () => {
    await db.update(cards).set({ points: 5, priority: "high" }).where(eq(cards.id, alice.cardId));
    const { GET } = await import("@/app/api/boards/[id]/export/route");
    const res = await GET(req("GET"), ctx(alice.boardId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const [header, ...rows] = text.split("\n");
    expect(header.split(",")).toEqual(expect.arrayContaining(["Key", "Summary", "Status", "Priority", "Points"]));
    expect(rows.some((r) => r.includes("high") && r.includes("5"))).toBe(true);
  });

  it("another tenant gets 404, not a CSV of someone else's work", async () => {
    const bob = await seedTenant("bob");
    identity.sub = bob.sub; identity.email = bob.email;
    const { GET } = await import("@/app/api/boards/[id]/export/route");
    expect((await GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("copying a board", () => {
  it("copies lists, cards and labels but not comments or history", async () => {
    const { POST } = await import("@/app/api/boards/[id]/copy/route");
    const res = await POST(req("POST", { title: "Copy of alice board" }), ctx(alice.boardId));
    expect(res.status).toBe(201);
    const { boardId } = await res.json();
    expect(boardId).not.toBe(alice.boardId);

    const copied = await db.select().from(cards).where(eq(cards.boardId, boardId));
    expect(copied).toHaveLength(1);
    expect(copied[0].id).not.toBe(alice.cardId);
    expect(await db.select().from(comments).where(eq(comments.cardId, copied[0].id))).toHaveLength(0);
    // and the original is untouched
    expect(await db.select().from(cards).where(eq(cards.boardId, alice.boardId))).toHaveLength(1);
  });

  it("can copy the structure without the cards, which is what a template is", async () => {
    const { POST } = await import("@/app/api/boards/[id]/copy/route");
    const { boardId } = await (await POST(req("POST", { title: "Template", withCards: false }), ctx(alice.boardId))).json();
    expect(await db.select().from(lists).where(eq(lists.boardId, boardId))).toHaveLength(1);
    expect(await db.select().from(cards).where(eq(cards.boardId, boardId))).toHaveLength(0);
  });

  it("a board the caller cannot see cannot be copied", async () => {
    const bob = await seedTenant("bob");
    identity.sub = bob.sub; identity.email = bob.email;
    const { POST } = await import("@/app/api/boards/[id]/copy/route");
    expect((await POST(req("POST", { title: "Nice board" }), ctx(alice.boardId))).status).toBe(404);
    expect(await db.select().from(boards).where(and(eq(boards.title, "Nice board"), eq(boards.workspaceId, bob.workspaceId)))).toHaveLength(0);
  });
});
