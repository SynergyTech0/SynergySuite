import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cardFieldValues, customFields, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST custom fields (Jira's per-project fields).
 *
 * A field belongs to one board, like a label. Defining fields is an admin action; filling them in is
 * an ordinary edit. Values are validated against the field's type on the way in — a select only takes
 * its own options, a user field only someone who can see the board — so a board cannot accumulate
 * values that no longer mean anything.
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

const defineField = async (boardId: string, body: Record<string, unknown>) =>
  (await import("@/app/api/boards/[id]/fields/route")).POST(req("POST", body), ctx(boardId));
const setValue = async (cardId: string, body: Record<string, unknown>) =>
  (await import("@/app/api/cards/[id]/fields/route")).PUT(req("PUT", body), ctx(cardId));

async function teammate(slug: string, t: Tenant, role: "member" | "observer") {
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

describe("defining fields", () => {
  it("an admin defines fields of each type; names are unique per board", async () => {
    expect((await defineField(alice.boardId, { name: "Team", type: "select", options: ["Growth", "Core"] })).status).toBe(201);
    expect((await defineField(alice.boardId, { name: "Customer", type: "text" })).status).toBe(201);
    expect((await defineField(alice.boardId, { name: "Team", type: "text" })).status).toBe(409);
    actAs(bob);
    expect((await defineField(bob.boardId, { name: "Team", type: "text" })).status).toBe(201);
  });

  it("refuses an unknown type, a select with no options, a member, and another tenant", async () => {
    expect((await defineField(alice.boardId, { name: "X", type: "colour" })).status).toBe(400);
    expect((await defineField(alice.boardId, { name: "X", type: "select", options: [] })).status).toBe(400);
    actAs(await teammate("carol", alice, "member"));
    expect((await defineField(alice.boardId, { name: "X", type: "text" })).status).toBe(403);
    actAs(bob);
    expect((await defineField(alice.boardId, { name: "X", type: "text" })).status).toBe(404);
  });

  it("renames, reorders and deletes, taking the values with it", async () => {
    const f = await (await defineField(alice.boardId, { name: "Team", type: "text" })).json();
    await setValue(alice.cardId, { fieldId: f.id, value: "Growth" });
    const byId = await import("@/app/api/fields/[id]/route");
    expect((await byId.PATCH(req("PATCH", { name: "Squad", position: 2 }), ctx(f.id))).status).toBe(200);
    expect((await byId.DELETE(req("DELETE"), ctx(f.id))).status).toBe(200);
    expect(await db.select().from(customFields)).toHaveLength(0);
    expect(await db.select().from(cardFieldValues)).toHaveLength(0);
  });
});

describe("setting values", () => {
  it("a member sets and clears values, and they appear on the card and the snapshot", async () => {
    const team = await (await defineField(alice.boardId, { name: "Team", type: "select", options: ["Growth", "Core"] })).json();
    const size = await (await defineField(alice.boardId, { name: "Size", type: "number" })).json();
    actAs(await teammate("carol", alice, "member"));

    expect((await setValue(alice.cardId, { fieldId: team.id, value: "Growth" })).status).toBe(200);
    expect((await setValue(alice.cardId, { fieldId: size.id, value: 3 })).status).toBe(200);

    const detail = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.fields).toEqual({ [team.id]: "Growth", [size.id]: 3 });
    const snap = await (await (await import("@/app/api/boards/[id]/route")).GET(req("GET"), ctx(alice.boardId))).json();
    expect(snap.customFields.map((f: { name: string }) => f.name)).toEqual(["Team", "Size"]);

    expect((await setValue(alice.cardId, { fieldId: team.id, value: null })).status).toBe(200);
    const after = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(after.fields).toEqual({ [size.id]: 3 });
  });

  it("validates against the field's type", async () => {
    const select = await (await defineField(alice.boardId, { name: "Team", type: "select", options: ["Growth"] })).json();
    const number = await (await defineField(alice.boardId, { name: "Size", type: "number" })).json();
    const date = await (await defineField(alice.boardId, { name: "Review on", type: "date" })).json();
    const person = await (await defineField(alice.boardId, { name: "Owner", type: "user" })).json();
    const flag = await (await defineField(alice.boardId, { name: "Regression", type: "checkbox" })).json();

    expect((await setValue(alice.cardId, { fieldId: select.id, value: "Nope" })).status).toBe(400);
    expect((await setValue(alice.cardId, { fieldId: number.id, value: "three" })).status).toBe(400);
    expect((await setValue(alice.cardId, { fieldId: date.id, value: "someday" })).status).toBe(400);
    expect((await setValue(alice.cardId, { fieldId: person.id, value: bob.userId })).status).toBe(404);
    expect((await setValue(alice.cardId, { fieldId: flag.id, value: "yes" })).status).toBe(400);
    expect((await setValue(alice.cardId, { fieldId: flag.id, value: true })).status).toBe(200);
    expect((await setValue(alice.cardId, { fieldId: person.id, value: alice.userId })).status).toBe(200);
  });

  it("refuses a field from another board, and an observer", async () => {
    actAs(bob);
    const theirs = await (await defineField(bob.boardId, { name: "Team", type: "text" })).json();
    actAs(alice);
    expect((await setValue(alice.cardId, { fieldId: theirs.id, value: "x" })).status).toBe(404);

    const mine = await (await defineField(alice.boardId, { name: "Team", type: "text" })).json();
    actAs(await teammate("olly", alice, "observer"));
    expect((await setValue(alice.cardId, { fieldId: mine.id, value: "x" })).status).toBe(403);
  });

  it("records the change in history", async () => {
    const f = await (await defineField(alice.boardId, { name: "Team", type: "text" })).json();
    await setValue(alice.cardId, { fieldId: f.id, value: "Growth" });
    const detail = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.activity.some((a: { data: { field?: string } }) => a.data?.field === "Team")).toBe(true);
  });
});

describe("searching by custom field", () => {
  it("finds cards by a custom field value", async () => {
    const f = await (await defineField(alice.boardId, { name: "Team", type: "select", options: ["Growth", "Core"] })).json();
    await setValue(alice.cardId, { fieldId: f.id, value: "Growth" });

    const { GET } = await import("@/app/api/search/jql/route");
    const hit = await (await GET(new Request(`http://localhost/api/search/jql?q=${encodeURIComponent('cf[Team] = Growth')}`))).json();
    expect(hit.cards.map((c: { id: string }) => c.id)).toEqual([alice.cardId]);
    const miss = await (await GET(new Request(`http://localhost/api/search/jql?q=${encodeURIComponent('cf[Team] = Core')}`))).json();
    expect(miss.cards).toEqual([]);
  });
});
