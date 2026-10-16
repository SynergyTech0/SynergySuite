import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, cards, checklists, comments, labels, lists } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST tenancy tests (T1).
 *
 * Today no route checks workspace or board membership: `GET /api/boards` returns every board,
 * `GET /api/users` returns every user, and most card/list/label/checklist/sprint routes resolve no
 * user at all. A signed-in member of workspace A can read and mutate workspace B's data by id.
 * For a sellable multi-tenant SKU that is a correctness bug, so these tests describe the REQUIRED
 * behaviour and are expected to fail until lib/authz.ts exists and is applied.
 *
 * Convention asserted here: anything the caller may not see answers 404, never 403 — a 403 confirms
 * the resource exists, which is itself a cross-tenant leak.
 */

// Identity is whatever the proxy forwards; getCurrentUser() reads it via next/headers. Mocking the
// header source (rather than the session module) keeps the real provisioning path under test.
const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-user": identity.sub,
      "x-forwarded-email": identity.email,
    }),
}));

function actAs(tenant: Tenant) {
  identity.sub = tenant.sub;
  identity.email = tenant.email;
}

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const withBody = (method: string, body: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(bob); // Bob is the attacker in every cross-tenant case below
});

afterAll(async () => {
  await closeDb();
});

describe("cross-tenant reads are refused", () => {
  it("GET /api/boards lists only the caller's boards", async () => {
    const { GET } = await import("@/app/api/boards/route");
    const rows = await (await GET()).json();

    expect(rows.map((b: { id: string }) => b.id)).toEqual([bob.boardId]);
  });

  it("GET /api/boards/[id] refuses another tenant's board", async () => {
    const { GET } = await import("@/app/api/boards/[id]/route");
    const res = await GET(new Request("http://localhost/api"), ctx(alice.boardId));

    expect(res.status).toBe(404);
  });

  it("GET /api/cards/[id] refuses another tenant's card", async () => {
    const { GET } = await import("@/app/api/cards/[id]/route");
    const res = await GET(new Request("http://localhost/api"), ctx(alice.cardId));

    expect(res.status).toBe(404);
  });

  it("GET /api/labels refuses another tenant's board", async () => {
    const { GET } = await import("@/app/api/labels/route");
    const res = await GET(new Request(`http://localhost/api/labels?boardId=${alice.boardId}`));

    expect(res.status).toBe(404);
  });

  it("GET /api/sprints refuses another tenant's board", async () => {
    const { GET } = await import("@/app/api/sprints/route");
    const res = await GET(new Request(`http://localhost/api/sprints?boardId=${alice.boardId}`));

    expect(res.status).toBe(404);
  });

  it("GET /api/users returns only people who share a workspace with the caller", async () => {
    const { GET } = await import("@/app/api/users/route");
    const rows = await (await GET()).json();

    expect(rows.map((u: { id: string }) => u.id)).toEqual([bob.userId]);
  });
});

describe("cross-tenant writes are refused and change nothing", () => {
  it("PATCH /api/cards/[id] cannot edit another tenant's card", async () => {
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await PATCH(withBody("PATCH", { title: "hijacked" }), ctx(alice.cardId));

    expect(res.status).toBe(404);
    const [card] = await db.select().from(cards).where(eq(cards.id, alice.cardId));
    expect(card.title).toBe("alice card");
  });

  it("DELETE /api/cards/[id] cannot delete another tenant's card", async () => {
    const { DELETE } = await import("@/app/api/cards/[id]/route");
    const res = await DELETE(new Request("http://localhost/api", { method: "DELETE" }), ctx(alice.cardId));

    expect(res.status).toBe(404);
    expect(await db.select().from(cards).where(eq(cards.id, alice.cardId))).toHaveLength(1);
  });

  it("POST /api/lists cannot add a list to another tenant's board", async () => {
    const { POST } = await import("@/app/api/lists/route");
    const res = await POST(json({ boardId: alice.boardId, title: "intruder list" }));

    expect(res.status).toBe(404);
    expect(await db.select().from(lists).where(eq(lists.boardId, alice.boardId))).toHaveLength(1);
  });

  it("POST /api/cards cannot add a card to another tenant's list", async () => {
    const { POST } = await import("@/app/api/cards/route");
    const res = await POST(json({ listId: alice.listId, title: "intruder card" }));

    expect(res.status).toBe(404);
    expect(await db.select().from(cards).where(eq(cards.listId, alice.listId))).toHaveLength(1);
  });

  it("POST /api/comments cannot comment on another tenant's card", async () => {
    const { POST } = await import("@/app/api/comments/route");
    const res = await POST(json({ cardId: alice.cardId, body: "intruder comment" }));

    expect(res.status).toBe(404);
    expect(await db.select().from(comments).where(eq(comments.cardId, alice.cardId))).toHaveLength(1);
  });

  it("POST /api/labels cannot add a label to another tenant's board", async () => {
    const { POST } = await import("@/app/api/labels/route");
    const res = await POST(json({ boardId: alice.boardId, color: "#000000" }));

    expect(res.status).toBe(404);
    expect(await db.select().from(labels).where(eq(labels.boardId, alice.boardId))).toHaveLength(1);
  });

  it("POST /api/checklists cannot add a checklist to another tenant's card", async () => {
    const { POST } = await import("@/app/api/checklists/route");
    const res = await POST(json({ cardId: alice.cardId, title: "intruder checklist" }));

    expect(res.status).toBe(404);
    expect(await db.select().from(checklists).where(eq(checklists.cardId, alice.cardId))).toHaveLength(1);
  });

  it("POST /api/cards/[id]/labels cannot label another tenant's card", async () => {
    const { POST } = await import("@/app/api/cards/[id]/labels/route");
    const res = await POST(json({ labelId: alice.labelId }), ctx(alice.cardId));

    expect(res.status).toBe(404);
  });

  it("POST /api/sprints cannot add a sprint to another tenant's board", async () => {
    const { POST } = await import("@/app/api/sprints/route");
    const res = await POST(json({ boardId: alice.boardId, name: "intruder sprint" }));

    expect(res.status).toBe(404);
  });
});

describe("new boards belong to the creator, not to whichever workspace existed first", () => {
  it("POST /api/boards puts the board in the caller's own workspace", async () => {
    const { POST } = await import("@/app/api/boards/route");
    const created = await (await POST(json({ title: "bob's second board" }))).json();

    const [board] = await db.select().from(boards).where(eq(boards.id, created.id));
    expect(board.workspaceId).toBe(bob.workspaceId);
    expect(board.workspaceId).not.toBe(alice.workspaceId);
  });
});

describe("a tenant keeps full access to its own data", () => {
  it("can read its own board snapshot, card and labels", async () => {
    const boardRoute = await import("@/app/api/boards/[id]/route");
    const cardRoute = await import("@/app/api/cards/[id]/route");
    const labelRoute = await import("@/app/api/labels/route");

    expect((await boardRoute.GET(new Request("http://localhost/api"), ctx(bob.boardId))).status).toBe(200);
    expect((await cardRoute.GET(new Request("http://localhost/api"), ctx(bob.cardId))).status).toBe(200);
    expect(
      (await labelRoute.GET(new Request(`http://localhost/api/labels?boardId=${bob.boardId}`))).status,
    ).toBe(200);
  });

  it("can add a list, a card and a comment to its own board", async () => {
    const listRoute = await import("@/app/api/lists/route");
    const cardRoute = await import("@/app/api/cards/route");
    const commentRoute = await import("@/app/api/comments/route");

    const listRes = await listRoute.POST(json({ boardId: bob.boardId, title: "own list" }));
    expect(listRes.status).toBe(201);

    const cardRes = await cardRoute.POST(json({ listId: bob.listId, title: "own card" }));
    expect(cardRes.status).toBe(201);

    const commentRes = await commentRoute.POST(json({ cardId: bob.cardId, body: "own comment" }));
    expect(commentRes.status).toBe(201);
  });

  it("can edit and delete its own card", async () => {
    const { PATCH, DELETE } = await import("@/app/api/cards/[id]/route");

    expect((await PATCH(withBody("PATCH", { title: "renamed" }), ctx(bob.cardId))).status).toBe(200);
    const [card] = await db.select().from(cards).where(eq(cards.id, bob.cardId));
    expect(card.title).toBe("renamed");

    expect(
      (await DELETE(new Request("http://localhost/api", { method: "DELETE" }), ctx(bob.cardId))).status,
    ).toBe(200);
    expect(await db.select().from(cards).where(eq(cards.id, bob.cardId))).toHaveLength(0);
  });
});
