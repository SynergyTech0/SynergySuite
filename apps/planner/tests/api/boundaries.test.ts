import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, comments, sprints } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * Regression tests for the cross-tenant boundaries found in security review.
 *
 * Each of these was a real, reachable defect: a field that points at another row is a way out of
 * the board unless it is checked, and the mind ingest carries a single shared token for the whole
 * deployment, so anything it looks up by bare primary key reaches every tenant.
 */

const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));

function actAs(tenant: Tenant) {
  identity.sub = tenant.sub;
  identity.email = tenant.email;
}

const patch = (payload: unknown) =>
  new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const MIND_TOKEN = process.env.MIND_TOKEN!;

async function postMind(body: unknown) {
  const { POST } = await import("@/app/api/mind/route");
  return POST(
    new Request("http://localhost/api/mind", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Mind-Token": MIND_TOKEN },
      body: JSON.stringify(body),
    }),
  );
}

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(bob);
});

afterAll(async () => {
  await closeDb();
});

describe("a card cannot be pointed at another board's rows", () => {
  it("refuses a sprintId belonging to another board", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await PATCH(patch({ sprintId: alice.sprintId }), ctx(bob.cardId));

    expect(res.status).toBe(404);
    const [card] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(card.sprintId).toBeNull();
  });

  it("refuses a parentId belonging to another board", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await PATCH(patch({ parentId: alice.cardId }), ctx(bob.cardId));

    expect(res.status).toBe(404);
    const [card] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(card.parentId).toBeNull();
  });

  it("still allows a sprint and a parent from the caller's own board", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const [ownParent] = await db
      .insert(cards)
      .values({ listId: bob.listId, boardId: bob.boardId, title: "epic", position: 2048 })
      .returning();

    expect((await PATCH(patch({ sprintId: bob.sprintId }), ctx(bob.cardId))).status).toBe(200);
    expect((await PATCH(patch({ parentId: ownParent.id }), ctx(bob.cardId))).status).toBe(200);

    const [card] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(card.sprintId).toBe(bob.sprintId);
    expect(card.parentId).toBe(ownParent.id);
  });
});

describe("completing a sprint only touches its own board", () => {
  it("leaves a foreign card pointed at this sprint untouched", async () => {
    // A card from alice's board pointed at bob's sprint — possible because sprintId has no FK, and
    // exactly what pre-existing data could look like before the PATCH guard above existed.
    await db.update(cards).set({ sprintId: bob.sprintId }).where(eq(cards.id, alice.cardId));
    await db.update(sprints).set({ state: "active" }).where(eq(sprints.id, bob.sprintId));

    const { PATCH } = await import("@/app/api/sprints/[id]/route");
    const res = await PATCH(patch({ state: "completed" }), ctx(bob.sprintId));
    expect(res.status).toBe(200);

    const [foreign] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(foreign.sprintId).toBe(bob.sprintId); // untouched: it is not bob's to clear

    const body = await res.json();
    expect(body.returnedToBacklog).toBe(0);
  });

  it("does return this board's own unfinished cards to the backlog", async () => {
    await db.update(cards).set({ sprintId: bob.sprintId }).where(eq(cards.id, bob.cardId));
    await db.update(sprints).set({ state: "active" }).where(eq(sprints.id, bob.sprintId));

    const { PATCH } = await import("@/app/api/sprints/[id]/route");
    const res = await PATCH(patch({ state: "completed" }), ctx(bob.sprintId));

    expect((await res.json()).returnedToBacklog).toBe(1);
    const [own] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(own.sprintId).toBeNull();
  });
});

describe("the mind ingest cannot reach another tenant's card", () => {
  it("refuses to comment on a card outside the board it resolved", async () => {
    // The mind files into its own board, then is handed a card id from a different tenant.
    await postMind({ action: "file", ref: "m-1", title: "a mind card" });

    const res = await postMind({ action: "comment", cardId: alice.cardId, body: "not yours" });

    expect(res.status).toBe(404);
    expect(await db.select().from(comments).where(eq(comments.cardId, alice.cardId))).toHaveLength(1);
  });

  it("still comments on a card inside its own board", async () => {
    const filed = await (await postMind({ action: "file", ref: "m-2", title: "mind card" })).json();
    const res = await postMind({ action: "comment", cardId: filed.id, body: "mine" });

    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(comments)
      .where(and(eq(comments.cardId, filed.id), eq(comments.origin, "mind")));
    expect(rows).toHaveLength(1);
  });
});
