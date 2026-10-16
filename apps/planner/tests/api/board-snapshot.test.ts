import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { attachments, cardMembers, cards, checklistItems } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST card-face badges. A Trello card face shows, without opening it: who is on it, how far
 * its checklist is, whether it has comments, attachments or a description, its dates and its cover.
 * The board snapshot carried none of that, so the face could not either.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub;
  identity.email = alice.email;
});

afterAll(async () => {
  await closeDb();
});

describe("board snapshot carries card-face badges", () => {
  it("counts checklist progress, comments and attachments, and lists assignees", async () => {
    await db.insert(checklistItems).values([
      { checklistId: alice.checklistId, text: "a", position: 1, isChecked: true },
      { checklistId: alice.checklistId, text: "b", position: 2, isChecked: false },
    ]);
    await db.insert(cardMembers).values({ cardId: alice.cardId, userId: alice.userId });
    await db.insert(attachments).values({ cardId: alice.cardId, name: "spec", url: "https://example.com" });

    const { GET } = await import("@/app/api/boards/[id]/route");
    const snap = await (await GET(new Request("http://localhost"), ctx(alice.boardId))).json();
    const card = snap.cards.find((c: { id: string }) => c.id === alice.cardId);

    expect(card.badges).toEqual({
      checklistDone: 1, checklistTotal: 2, comments: 1, attachments: 1, hasDescription: false, blockedBy: 0,
    });
    expect(card.members).toEqual([{ id: alice.userId, name: "User alice", isMind: false }]);
  });

  it("a card with nothing on it has zeroed badges, not missing ones", async () => {
    const [bare] = await db.insert(cards).values({ listId: alice.listId, boardId: alice.boardId, title: "bare", position: 5000, description: "has text" }).returning();
    const { GET } = await import("@/app/api/boards/[id]/route");
    const snap = await (await GET(new Request("http://localhost"), ctx(alice.boardId))).json();
    const card = snap.cards.find((c: { id: string }) => c.id === bare.id);
    expect(card.badges).toEqual({ checklistDone: 0, checklistTotal: 0, comments: 0, attachments: 0, hasDescription: true, blockedBy: 0 });
    expect(card.members).toEqual([]);
  });

  it("the server-rendered board page gets the same badges", async () => {
    await db.insert(cardMembers).values({ cardId: alice.cardId, userId: alice.userId });
    const { default: BoardPage } = await import("@/app/b/[id]/page");
    const el = (await BoardPage(ctx(alice.boardId))) as { props: { initialCards: { id: string; badges: unknown; members: unknown[] }[] } };
    const card = el.props.initialCards.find((c) => c.id === alice.cardId)!;
    expect(card.badges).toMatchObject({ comments: 1 });
    expect(card.members).toHaveLength(1);
  });
});
