import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activities, attachments, boardMembers, boards, cardLabels, cardMembers, cards, checklistItems,
  checklists, comments, labels, lists, users, workspaceMembers,
} from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST: the Trello card, beyond create/edit/move.
 *
 * Today you cannot edit or delete a comment, rename or delete a checklist, edit/delete/assign a
 * checklist item, rename or delete a label, attach anything, give a card a start date or cover, copy
 * a card, or move a card to another board. Each is a daily Trello action, and each of them is also a
 * new way to reach across a tenant or role boundary, so the refusals are tested alongside.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function colleague(slug: string, t: Tenant, role: "member" | "admin" | "observer" = "member") {
  const [u] = await db.insert(users).values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: t.workspaceId, userId: u.id, role });
  return { userId: u.id, sub: u.authSub!, email: u.email! };
}

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("comments can be edited and deleted", () => {
  it("the author edits their comment, it is marked edited, and history records it", async () => {
    const { PATCH } = await import("@/app/api/comments/[id]/route");
    const res = await PATCH(req("PATCH", { body: "fixed typo" }), ctx(alice.commentId));
    expect(res.status).toBe(200);
    const [c] = await db.select().from(comments).where(eq(comments.id, alice.commentId));
    expect(c.body).toBe("fixed typo");
    expect(c.editedAt).not.toBeNull();
    const [row] = await db.select().from(activities).where(eq(activities.type, "comment_edited"));
    expect(row?.cardId).toBe(alice.cardId);
  });

  it("another member cannot edit someone else's comment", async () => {
    actAs(await colleague("carol", alice));
    const { PATCH } = await import("@/app/api/comments/[id]/route");
    expect((await PATCH(req("PATCH", { body: "put words in her mouth" }), ctx(alice.commentId))).status).toBe(403);
  });

  it("a board admin can delete someone else's comment (moderation), a plain member cannot", async () => {
    const { DELETE } = await import("@/app/api/comments/[id]/route");
    actAs(await colleague("carol", alice, "member"));
    expect((await DELETE(req("DELETE"), ctx(alice.commentId))).status).toBe(403);
    actAs(await colleague("dave", alice, "admin"));
    expect((await DELETE(req("DELETE"), ctx(alice.commentId))).status).toBe(200);
    expect(await db.select().from(comments).where(eq(comments.id, alice.commentId))).toHaveLength(0);
  });

  it("another tenant gets 404", async () => {
    actAs(bob);
    const { PATCH } = await import("@/app/api/comments/[id]/route");
    expect((await PATCH(req("PATCH", { body: "x" }), ctx(alice.commentId))).status).toBe(404);
  });
});

describe("checklists and items", () => {
  it("renames and deletes a checklist", async () => {
    const route = await import("@/app/api/checklists/[id]/route");
    expect((await route.PATCH(req("PATCH", { title: "Release steps" }), ctx(alice.checklistId))).status).toBe(200);
    const [cl] = await db.select().from(checklists).where(eq(checklists.id, alice.checklistId));
    expect(cl.title).toBe("Release steps");
    expect((await route.DELETE(req("DELETE"), ctx(alice.checklistId))).status).toBe(200);
    expect(await db.select().from(checklists).where(eq(checklists.id, alice.checklistId))).toHaveLength(0);
  });

  it("assigns an item to a workspace peer and gives it a due date", async () => {
    const [item] = await db.insert(checklistItems).values({ checklistId: alice.checklistId, text: "t", position: 1 }).returning();
    const carol = await colleague("carol", alice);
    const { PATCH } = await import("@/app/api/checklist-items/[id]/route");
    const res = await PATCH(req("PATCH", { assigneeId: carol.userId, dueDate: "2026-10-01" }), ctx(item.id));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(checklistItems).where(eq(checklistItems.id, item.id));
    expect(row.assigneeId).toBe(carol.userId);
    expect(row.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("refuses to assign an item to someone from another tenant", async () => {
    const [item] = await db.insert(checklistItems).values({ checklistId: alice.checklistId, text: "t", position: 1 }).returning();
    const { PATCH } = await import("@/app/api/checklist-items/[id]/route");
    expect((await PATCH(req("PATCH", { assigneeId: bob.userId }), ctx(item.id))).status).toBe(404);
  });
});

describe("labels can be managed", () => {
  it("renames and recolours a label", async () => {
    const { PATCH } = await import("@/app/api/labels/[id]/route");
    expect((await PATCH(req("PATCH", { name: "Blocked", color: "#ef4444" }), ctx(alice.labelId))).status).toBe(200);
    const [l] = await db.select().from(labels).where(eq(labels.id, alice.labelId));
    expect(l).toMatchObject({ name: "Blocked", color: "#ef4444" });
  });

  it("deleting a label removes it from every card", async () => {
    await db.insert(cardLabels).values({ cardId: alice.cardId, labelId: alice.labelId });
    const { DELETE } = await import("@/app/api/labels/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(alice.labelId))).status).toBe(200);
    expect(await db.select().from(cardLabels).where(eq(cardLabels.labelId, alice.labelId))).toHaveLength(0);
  });

  it("an observer cannot, and another tenant gets 404", async () => {
    const { PATCH } = await import("@/app/api/labels/[id]/route");
    actAs(await colleague("olly", alice, "observer"));
    expect((await PATCH(req("PATCH", { name: "x" }), ctx(alice.labelId))).status).toBe(403);
    actAs(bob);
    expect((await PATCH(req("PATCH", { name: "x" }), ctx(alice.labelId))).status).toBe(404);
  });
});

describe("attachments and cover", () => {
  it("attaches a link, shows it on the card, records history, and removes it", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const res = await POST(req("POST", { cardId: alice.cardId, url: "https://example.com/spec.pdf", name: "Spec" }));
    expect(res.status).toBe(201);
    const att = await res.json();

    const detail = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.attachments.map((a: { name: string }) => a.name)).toEqual(["Spec"]);

    const del = await (await import("@/app/api/attachments/[id]/route")).DELETE(req("DELETE"), ctx(att.id));
    expect(del.status).toBe(200);
    const types = (await db.select().from(activities).where(eq(activities.cardId, alice.cardId))).map((r) => r.type).sort();
    expect(types).toEqual(["attachment_added", "attachment_removed"]);
  });

  it("refuses a non-http link — javascript: or data: in an href is script injection", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "not a url"]) {
      expect((await POST(req("POST", { cardId: alice.cardId, url }))).status).toBe(400);
    }
    expect(await db.select().from(attachments)).toHaveLength(0);
  });

  it("sets a start date and a colour cover, and refuses a cover that is not a colour", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    expect((await PATCH(req("PATCH", { startDate: "2026-09-20", cover: "#22c55e" }), ctx(alice.cardId))).status).toBe(200);
    const [c] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(c.startDate?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(c.cover).toBe("#22c55e");
    expect((await PATCH(req("PATCH", { cover: "url(javascript:alert(1))" }), ctx(alice.cardId))).status).toBe(400);
  });
});

describe("copying a card", () => {
  it("copies title, description, labels, checklists and assignees into a new card with its own key", async () => {
    await db.insert(cardLabels).values({ cardId: alice.cardId, labelId: alice.labelId });
    await db.insert(cardMembers).values({ cardId: alice.cardId, userId: alice.userId });
    await db.insert(checklistItems).values({ checklistId: alice.checklistId, text: "step 1", position: 1, isChecked: true });
    await db.update(cards).set({ issueKey: "SYN-1", description: "details" }).where(eq(cards.id, alice.cardId));
    // Keys come from the board counter in real use; keep the counter consistent with the key set above.
    await db.update(boards).set({ seq: 1 }).where(eq(boards.id, alice.boardId));

    const { POST } = await import("@/app/api/cards/[id]/copy/route");
    const res = await POST(req("POST", { title: "alice card (copy)" }), ctx(alice.cardId));
    expect(res.status).toBe(201);
    const copy = await res.json();

    expect(copy.id).not.toBe(alice.cardId);
    expect(copy.issueKey).not.toBe("SYN-1");
    expect(copy).toMatchObject({ title: "alice card (copy)", description: "details", listId: alice.listId });
    expect(await db.select().from(cardLabels).where(eq(cardLabels.cardId, copy.id))).toHaveLength(1);
    expect(await db.select().from(cardMembers).where(eq(cardMembers.cardId, copy.id))).toHaveLength(1);
    const [cl] = await db.select().from(checklists).where(eq(checklists.cardId, copy.id));
    const items = await db.select().from(checklistItems).where(eq(checklistItems.checklistId, cl.id));
    // A copy is new work: its checklist starts unticked.
    expect(items.map((i) => [i.text, i.isChecked])).toEqual([["step 1", false]]);
  });

  it("refuses to copy into a list on another tenant's board", async () => {
    const { POST } = await import("@/app/api/cards/[id]/copy/route");
    expect((await POST(req("POST", { listId: bob.listId }), ctx(alice.cardId))).status).toBe(404);
  });
});

describe("moving a card to another board", () => {
  async function secondBoard() {
    const [b2] = await db.insert(boards).values({ workspaceId: alice.workspaceId, title: "Ops", keyPrefix: "OPS", createdBy: alice.userId }).returning();
    await db.insert(boardMembers).values({ boardId: b2.id, userId: alice.userId, role: "owner" });
    const [l2] = await db.insert(lists).values({ boardId: b2.id, title: "Inbox", position: 1 }).returning();
    return { boardId: b2.id, listId: l2.id };
  }

  it("moves it, gives it the target board's key, and drops what belongs to the old board", async () => {
    const target = await secondBoard();
    await db.insert(cardLabels).values({ cardId: alice.cardId, labelId: alice.labelId });
    await db.update(cards).set({ issueKey: "SYN-1", sprintId: alice.sprintId }).where(eq(cards.id, alice.cardId));

    const { POST } = await import("@/app/api/cards/[id]/move/route");
    const res = await POST(req("POST", { listId: target.listId }), ctx(alice.cardId));
    expect(res.status).toBe(200);

    const [c] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(c).toMatchObject({ boardId: target.boardId, listId: target.listId, sprintId: null, parentId: null });
    expect(c.issueKey).toMatch(/^OPS-\d+$/);
    // Labels are per board; carrying a label id across would attach another board's label.
    expect(await db.select().from(cardLabels).where(eq(cardLabels.cardId, alice.cardId))).toHaveLength(0);
    // Checklists, comments and the card's own history travel with it.
    expect(await db.select().from(checklists).where(eq(checklists.cardId, alice.cardId))).toHaveLength(1);
    const [moved] = await db.select().from(activities)
      .where(and(eq(activities.cardId, alice.cardId), eq(activities.type, "card_moved")));
    expect(moved.data).toMatchObject({ fromBoard: "alice board", toBoard: "Ops", previousKey: "SYN-1" });
  });

  it("drops an assignee who cannot see the target board, keeps one who can", async () => {
    const target = await secondBoard();
    const carol = await colleague("carol", alice, "member");
    // carol can see board 1 via the workspace, but the target board is restricted to board members
    await db.update(cards).set({ assigneeId: carol.userId }).where(eq(cards.id, alice.cardId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, carol.userId));
    await db.insert(boardMembers).values({ boardId: alice.boardId, userId: carol.userId, role: "member" });

    const { POST } = await import("@/app/api/cards/[id]/move/route");
    await POST(req("POST", { listId: target.listId }), ctx(alice.cardId));
    const [c] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(c.assigneeId).toBeNull();
  });

  it("needs write access on the target board", async () => {
    const target = await secondBoard();
    const carol = await colleague("carol", alice, "member");
    await db.insert(boardMembers).values({ boardId: target.boardId, userId: carol.userId, role: "observer" });
    actAs(carol);
    const { POST } = await import("@/app/api/cards/[id]/move/route");
    expect((await POST(req("POST", { listId: target.listId }), ctx(alice.cardId))).status).toBe(403);
  });

  it("refuses a list on another tenant's board", async () => {
    const { POST } = await import("@/app/api/cards/[id]/move/route");
    expect((await POST(req("POST", { listId: bob.listId }), ctx(alice.cardId))).status).toBe(404);
    const [c] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(c.boardId).toBe(alice.boardId);
  });
});
