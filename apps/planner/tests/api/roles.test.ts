import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, cards, checklistItems, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST role enforcement. Every write route checked only that the caller could SEE the
 * board, so the "observer" role meant nothing: an observer could rename, move, comment on and delete
 * anything. In Trello and Jira an observer is read-only.
 *
 * The effective role is the board membership if there is one, else the workspace membership — so a
 * board-level observer row restricts a workspace member, and a workspace observer with no board row
 * is still an observer. Refusal is 403, not 404: the caller can already see the board.
 */

const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));

const actAs = (who: { sub: string; email: string }) => { identity.sub = who.sub; identity.email = who.email; };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function person(slug: string, ws: { workspaceId: string }, wsRole: "member" | "observer", boardRole?: { boardId: string; role: "observer" | "member" }) {
  const [u] = await db.insert(users)
    .values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.workspaceId, userId: u.id, role: wsRole });
  if (boardRole) await db.insert(boardMembers).values({ boardId: boardRole.boardId, userId: u.id, role: boardRole.role });
  return { userId: u.id, sub: u.authSub!, email: u.email! };
}

let alice: Tenant;
let itemId: string;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  const [item] = await db.insert(checklistItems)
    .values({ checklistId: alice.checklistId, text: "item", position: 1024 }).returning();
  itemId = item.id;
});

afterAll(async () => {
  await closeDb();
});

type Call = [string, () => Promise<Response>];

const writes = (): Call[] => [
  ["create card", async () => (await import("@/app/api/cards/route")).POST(req("POST", { listId: alice.listId, title: "x" }))],
  ["edit card", async () => (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", { title: "hijacked" }), ctx(alice.cardId))],
  ["delete card", async () => (await import("@/app/api/cards/[id]/route")).DELETE(req("DELETE"), ctx(alice.cardId))],
  ["comment", async () => (await import("@/app/api/comments/route")).POST(req("POST", { cardId: alice.cardId, body: "hi" }))],
  ["add checklist", async () => (await import("@/app/api/checklists/route")).POST(req("POST", { cardId: alice.cardId, title: "c" }))],
  ["add checklist item", async () => (await import("@/app/api/checklist-items/route")).POST(req("POST", { checklistId: alice.checklistId, text: "t" }))],
  ["tick checklist item", async () => (await import("@/app/api/checklist-items/[id]/route")).PATCH(req("PATCH", { isChecked: true }), ctx(itemId))],
  ["delete checklist item", async () => (await import("@/app/api/checklist-items/[id]/route")).DELETE(req("DELETE"), ctx(itemId))],
  ["create label", async () => (await import("@/app/api/labels/route")).POST(req("POST", { boardId: alice.boardId, color: "#000" }))],
  ["label a card", async () => (await import("@/app/api/cards/[id]/labels/route")).POST(req("POST", { labelId: alice.labelId }), ctx(alice.cardId))],
  ["unlabel a card", async () => (await import("@/app/api/cards/[id]/labels/route")).DELETE(req("DELETE", { labelId: alice.labelId }), ctx(alice.cardId))],
  ["assign a card", async () => (await import("@/app/api/cards/[id]/members/route")).POST(req("POST", { userId: alice.userId }), ctx(alice.cardId))],
  ["unassign a card", async () => (await import("@/app/api/cards/[id]/members/route")).DELETE(req("DELETE", { userId: alice.userId }), ctx(alice.cardId))],
  ["create list", async () => (await import("@/app/api/lists/route")).POST(req("POST", { boardId: alice.boardId, title: "l" }))],
  ["rename list", async () => (await import("@/app/api/lists/[id]/route")).PATCH(req("PATCH", { title: "l2" }), ctx(alice.listId))],
  ["delete list", async () => (await import("@/app/api/lists/[id]/route")).DELETE(req("DELETE"), ctx(alice.listId))],
  ["create sprint", async () => (await import("@/app/api/sprints/route")).POST(req("POST", { boardId: alice.boardId, name: "s" }))],
  ["start sprint", async () => (await import("@/app/api/sprints/[id]/route")).PATCH(req("PATCH", { state: "active" }), ctx(alice.sprintId))],
  ["delete sprint", async () => (await import("@/app/api/sprints/[id]/route")).DELETE(req("DELETE"), ctx(alice.sprintId))],
  ["rename board", async () => (await import("@/app/api/boards/[id]/route")).PATCH(req("PATCH", { title: "b2" }), ctx(alice.boardId))],
];

describe("a board observer is read-only", () => {
  it.each(writes().map(([name]) => [name]))("refuses: %s", async (name) => {
    const carol = await person("carol", alice, "member", { boardId: alice.boardId, role: "observer" });
    actAs(carol);
    const call = writes().find(([n]) => n === name)![1];
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("leaves the card untouched after a refused edit and delete", async () => {
    actAs(await person("carol", alice, "member", { boardId: alice.boardId, role: "observer" }));
    const route = await import("@/app/api/cards/[id]/route");
    await route.PATCH(req("PATCH", { title: "hijacked" }), ctx(alice.cardId));
    await route.DELETE(req("DELETE"), ctx(alice.cardId));
    const [card] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(card?.title).toBe("alice card");
  });

  it("can still read the board and its cards", async () => {
    actAs(await person("carol", alice, "member", { boardId: alice.boardId, role: "observer" }));
    expect((await (await import("@/app/api/boards/[id]/route")).GET(req("GET"), ctx(alice.boardId))).status).toBe(200);
    expect((await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).status).toBe(200);
  });
});

describe("the effective role comes from the board first, then the workspace", () => {
  it("a workspace observer with no board membership is read-only", async () => {
    actAs(await person("dave", alice, "observer"));
    const res = await (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", { title: "x" }), ctx(alice.cardId));
    expect(res.status).toBe(403);
  });

  it("a plain workspace member with no board membership can edit", async () => {
    actAs(await person("erin", alice, "member"));
    const res = await (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", { title: "edited" }), ctx(alice.cardId));
    expect(res.status).toBe(200);
  });

  it("a board member row lifts a workspace observer on that board", async () => {
    actAs(await person("finn", alice, "observer", { boardId: alice.boardId, role: "member" }));
    const res = await (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", { title: "edited" }), ctx(alice.cardId));
    expect(res.status).toBe(200);
  });
});
