import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, automations, cardLabels, cards, comments, labels, lists } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { planFor } from "@/lib/automation";

/**
 * FAILING-FIRST for Butler-style automation rules.
 *
 * The dangerous part of an automation is not the rule that does nothing — it is the rule that does
 * something twice, or on a board it was never meant to see. So the tests that matter most here are
 * the ones about cascading (an action that would trigger another rule) and about scope.
 */

const identity = { sub: "", email: "" };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-user": identity.sub, "x-forwarded-email": identity.email }),
}));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let alice: Tenant;
let doing: string, done: string;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub; identity.email = alice.email;
  const made = await db.insert(lists).values([
    { boardId: alice.boardId, title: "Doing", position: 2048, statusCategory: "in_progress" },
    { boardId: alice.boardId, title: "Done", position: 3072, statusCategory: "done" },
  ]).returning();
  doing = made[0].id; done = made[1].id;
});
afterAll(async () => { await closeDb(); });

describe("matching, without a database", () => {
  const rule = (trigger: object, action: unknown, when?: unknown) =>
    ({ id: "r", name: "r", trigger: { ...trigger, ...(when ? { when } : {}) }, action, isEnabled: true }) as never;

  it("a move rule fires only for the list it names", () => {
    const rules = [rule({ on: "card_moved", toListId: "L2" }, { do: "complete" })];
    expect(planFor(rules, { type: "card_moved", card: { listId: "L2" } as never })).toHaveLength(1);
    expect(planFor(rules, { type: "card_moved", card: { listId: "L9" } as never })).toHaveLength(0);
    expect(planFor(rules, { type: "card_created", card: { listId: "L2" } as never })).toHaveLength(0);
  });

  it("a rule with no list named fires on any move, and a disabled rule never fires", () => {
    expect(planFor([rule({ on: "card_moved" }, { do: "complete" })], { type: "card_moved", card: { listId: "X" } as never })).toHaveLength(1);
    const off = { id: "r", name: "r", trigger: { on: "card_moved" }, action: { do: "complete" }, isEnabled: false } as never;
    expect(planFor([off], { type: "card_moved", card: { listId: "X" } as never })).toHaveLength(0);
  });

  it("conditions narrow it further", () => {
    const rules = [rule({ on: "card_created" }, { do: "priority", value: "high" }, { issueType: "bug" })];
    expect(planFor(rules, { type: "card_created", card: { issueType: "bug" } as never })).toHaveLength(1);
    expect(planFor(rules, { type: "card_created", card: { issueType: "task" } as never })).toHaveLength(0);
  });
});

describe("rules running on a real card", () => {
  it("moving a card into Done assigns it, labels it and comments, and says so in the history", async () => {
    const [lbl] = await db.insert(labels).values({ boardId: alice.boardId, name: "shipped", color: "#61bd4f" }).returning();
    await db.insert(automations).values({
      boardId: alice.boardId, name: "When done, tidy up",
      trigger: { on: "card_moved", toListId: done },
      action: { do: "label", labelId: lbl.id },
      createdBy: alice.userId,
    });
    await db.insert(automations).values({
      boardId: alice.boardId, name: "Say so",
      trigger: { on: "card_moved", toListId: done },
      action: { do: "comment", text: "Shipped." },
      createdBy: alice.userId,
    });

    const { PATCH } = await import("@/app/api/cards/[id]/route");
    expect((await PATCH(req("PATCH", { listId: done }), ctx(alice.cardId))).status).toBe(200);

    expect(await db.select().from(cardLabels).where(eq(cardLabels.cardId, alice.cardId))).toHaveLength(1);
    // The seeded card already carries a human comment, so look for the one the rule wrote.
    const said = await db.select().from(comments).where(eq(comments.cardId, alice.cardId));
    expect(said.map((c) => c.body).join(" | ")).toContain("Shipped.");
    expect(said.find((c) => c.body.includes("Shipped."))!.userId).toBeNull();   // nobody typed it
    const ran = await db.select().from(activities)
      .where(and(eq(activities.cardId, alice.cardId), eq(activities.type, "automation_ran")));
    expect(ran).toHaveLength(2);
    expect(JSON.stringify(ran.map((r) => r.data))).toContain("When done, tidy up");
  });

  it("an action that would trigger another rule does not cascade", async () => {
    // Rule A moves the card to Done; rule B fires on arriving in Done. One pass only: B must not run,
    // or two rules pointing at each other would loop until the request died.
    await db.insert(automations).values([
      { boardId: alice.boardId, name: "A", trigger: { on: "card_created" }, action: { do: "move", toListId: done }, createdBy: alice.userId },
      { boardId: alice.boardId, name: "B", trigger: { on: "card_moved", toListId: done }, action: { do: "comment", text: "cascaded" }, createdBy: alice.userId },
    ]);
    const { POST } = await import("@/app/api/cards/route");
    const res = await POST(req("POST", { listId: alice.listId, title: "new card" }));
    expect(res.status).toBe(201);
    const card = await res.json();

    expect((await db.select().from(cards).where(eq(cards.id, card.id)))[0].listId).toBe(done);
    expect(await db.select().from(comments).where(eq(comments.cardId, card.id))).toHaveLength(0);
  });

  it("only the card's own board's rules run", async () => {
    const bob = await seedTenant("bob");
    await db.insert(automations).values({
      boardId: bob.boardId, name: "Bob's rule", trigger: { on: "card_moved" },
      action: { do: "comment", text: "from bob's board" }, createdBy: bob.userId,
    });
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    await PATCH(req("PATCH", { listId: doing }), ctx(alice.cardId));
    const after = await db.select().from(comments).where(eq(comments.cardId, alice.cardId));
    expect(after.map((c) => c.body).join(" | ")).not.toContain("from bob's board");
    expect(after).toHaveLength(1);                     // still just the one the seed wrote
  });

  it("a rule that sets a due date sets it relative to now", async () => {
    await db.insert(automations).values({
      boardId: alice.boardId, name: "Give it a week", trigger: { on: "card_created" },
      action: { do: "due", plusDays: 7 }, createdBy: alice.userId,
    });
    const { POST } = await import("@/app/api/cards/route");
    const card = await (await POST(req("POST", { listId: alice.listId, title: "timed" }))).json();
    const [row] = await db.select().from(cards).where(eq(cards.id, card.id));
    const days = (row.dueDate!.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe("the automations API", () => {
  it("lists, creates and deletes rules for a board the caller administers", async () => {
    const { GET, POST } = await import("@/app/api/boards/[id]/automations/route");
    expect(await (await GET(req("GET"), ctx(alice.boardId))).json()).toEqual([]);

    const res = await POST(req("POST", {
      name: "Tidy", trigger: { on: "card_moved", toListId: done }, action: { do: "complete" },
    }), ctx(alice.boardId));
    expect(res.status).toBe(201);
    const rule = await res.json();

    expect(await (await GET(req("GET"), ctx(alice.boardId))).json()).toHaveLength(1);

    const { DELETE } = await import("@/app/api/automations/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(rule.id))).status).toBe(200);
    expect(await db.select().from(automations).where(eq(automations.id, rule.id))).toHaveLength(0);
  });

  it("refuses a rule whose action points at another board's list", async () => {
    const bob = await seedTenant("bob");
    const { POST } = await import("@/app/api/boards/[id]/automations/route");
    const res = await POST(req("POST", {
      name: "Escape", trigger: { on: "card_created" }, action: { do: "move", toListId: bob.listId },
    }), ctx(alice.boardId));
    expect(res.status).toBe(400);
  });

  it("another tenant cannot read or write a board's rules", async () => {
    const bob = await seedTenant("bob");
    identity.sub = bob.sub; identity.email = bob.email;
    const { GET, POST } = await import("@/app/api/boards/[id]/automations/route");
    expect((await GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
    expect((await POST(req("POST", { name: "x", trigger: { on: "card_created" }, action: { do: "complete" } }), ctx(alice.boardId))).status).toBe(404);
  });
});
