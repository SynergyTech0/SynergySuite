import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardFixVersions, cards, users, versions, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST Jira components and versions ("fix versions" / releases).
 *
 * Components and versions belong to one board (Jira: one project). A card can carry several of each,
 * but only its own board's — the same boundary rule as labels and sprints. Managing them is an admin
 * action, as in Jira; tagging a card is an ordinary edit. Releasing a version stamps it and can carry
 * unfinished work over to the next version rather than leaving it pinned to a shipped one.
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

async function member(slug: string, t: Tenant, role: "member" | "observer") {
  const [u] = await db.insert(users).values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: t.workspaceId, userId: u.id, role });
  return { userId: u.id, sub: u.authSub!, email: u.email! };
}

const createVersion = async (boardId: string, body: Record<string, unknown>) =>
  (await import("@/app/api/boards/[id]/versions/route")).POST(req("POST", body), ctx(boardId));
const createComponent = async (boardId: string, body: Record<string, unknown>) =>
  (await import("@/app/api/boards/[id]/components/route")).POST(req("POST", body), ctx(boardId));

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

describe("managing versions and components", () => {
  it("an admin creates a version with dates, and names are unique per board", async () => {
    const res = await createVersion(alice.boardId, { name: "v2.4", releaseDate: "2026-10-01", description: "Checkout rework" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "v2.4", releasedAt: null });
    expect((await createVersion(alice.boardId, { name: "v2.4" })).status).toBe(409);
    actAs(bob);
    expect((await createVersion(bob.boardId, { name: "v2.4" })).status).toBe(201);
  });

  it("a plain member cannot create one (admin action, as in Jira); another tenant gets 404", async () => {
    actAs(await member("carol", alice, "member"));
    expect((await createVersion(alice.boardId, { name: "v9" })).status).toBe(403);
    expect((await createComponent(alice.boardId, { name: "API" })).status).toBe(403);
    actAs(bob);
    expect((await createVersion(alice.boardId, { name: "v9" })).status).toBe(404);
  });

  it("components get a name and an optional lead who can see the board", async () => {
    const res = await createComponent(alice.boardId, { name: "Payments", leadId: alice.userId });
    expect(res.status).toBe(201);
    expect((await createComponent(alice.boardId, { name: "Search", leadId: bob.userId })).status).toBe(404);
  });

  it("listing versions includes progress: issues done out of total", async () => {
    const v = await (await createVersion(alice.boardId, { name: "v1" })).json();
    const [c2] = await db.insert(cards).values({ listId: alice.listId, boardId: alice.boardId, title: "two", position: 2, isComplete: true }).returning();
    await db.insert(cardFixVersions).values([{ cardId: alice.cardId, versionId: v.id }, { cardId: c2.id, versionId: v.id }]);
    const { GET } = await import("@/app/api/boards/[id]/versions/route");
    const list = await (await GET(req("GET"), ctx(alice.boardId))).json();
    expect(list[0]).toMatchObject({ name: "v1", total: 2, done: 1 });
  });
});

describe("tagging cards", () => {
  it("adds and removes a fix version and a component; the snapshot and card detail carry them", async () => {
    const v = await (await createVersion(alice.boardId, { name: "v1" })).json();
    const comp = await (await createComponent(alice.boardId, { name: "Mobile" })).json();
    actAs(await member("carol", alice, "member"));   // tagging is an ordinary edit

    const fv = await import("@/app/api/cards/[id]/fix-versions/route");
    const cc = await import("@/app/api/cards/[id]/components/route");
    expect((await fv.POST(req("POST", { versionId: v.id }), ctx(alice.cardId))).status).toBe(200);
    expect((await cc.POST(req("POST", { componentId: comp.id }), ctx(alice.cardId))).status).toBe(200);

    const snap = await (await (await import("@/app/api/boards/[id]/route")).GET(req("GET"), ctx(alice.boardId))).json();
    const face = snap.cards.find((c: { id: string }) => c.id === alice.cardId);
    expect(face.fixVersions).toEqual([{ id: v.id, name: "v1" }]);
    expect(face.components).toEqual([{ id: comp.id, name: "Mobile" }]);
    expect(snap.versions.map((x: { name: string }) => x.name)).toEqual(["v1"]);
    expect(snap.components.map((x: { name: string }) => x.name)).toEqual(["Mobile"]);

    await fv.DELETE(req("DELETE", { versionId: v.id }), ctx(alice.cardId));
    const detail = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.fixVersions).toEqual([]);
    expect(detail.components).toEqual([{ id: comp.id, name: "Mobile" }]);
  });

  it("refuses another board's version or component, and an observer", async () => {
    actAs(bob);
    const bobV = await (await createVersion(bob.boardId, { name: "b1" })).json();
    const bobC = await (await createComponent(bob.boardId, { name: "b" })).json();
    actAs(alice);
    const fv = await import("@/app/api/cards/[id]/fix-versions/route");
    const cc = await import("@/app/api/cards/[id]/components/route");
    expect((await fv.POST(req("POST", { versionId: bobV.id }), ctx(alice.cardId))).status).toBe(404);
    expect((await cc.POST(req("POST", { componentId: bobC.id }), ctx(alice.cardId))).status).toBe(404);

    const v = await (await createVersion(alice.boardId, { name: "v1" })).json();
    actAs(await member("olly", alice, "observer"));
    expect((await fv.POST(req("POST", { versionId: v.id }), ctx(alice.cardId))).status).toBe(403);
  });
});

describe("releasing", () => {
  it("stamps releasedAt and moves unfinished issues to the next version", async () => {
    const v1 = await (await createVersion(alice.boardId, { name: "v1" })).json();
    const v2 = await (await createVersion(alice.boardId, { name: "v2" })).json();
    const [shipped] = await db.insert(cards).values({ listId: alice.listId, boardId: alice.boardId, title: "shipped", position: 2, isComplete: true }).returning();
    await db.insert(cardFixVersions).values([{ cardId: alice.cardId, versionId: v1.id }, { cardId: shipped.id, versionId: v1.id }]);

    const { POST } = await import("@/app/api/versions/[id]/release/route");
    const res = await POST(req("POST", { moveUnresolvedTo: v2.id }), ctx(v1.id));
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toBe(1);

    const [row] = await db.select().from(versions).where(eq(versions.id, v1.id));
    expect(row.releasedAt).not.toBeNull();
    const onV2 = await db.select().from(cardFixVersions).where(eq(cardFixVersions.versionId, v2.id));
    expect(onV2.map((r) => r.cardId)).toEqual([alice.cardId]);
    const stillV1 = await db.select().from(cardFixVersions).where(and(eq(cardFixVersions.versionId, v1.id), eq(cardFixVersions.cardId, shipped.id)));
    expect(stillV1).toHaveLength(1);
  });

  it("refuses to carry work to a version on another board, or to itself", async () => {
    const v1 = await (await createVersion(alice.boardId, { name: "v1" })).json();
    actAs(bob);
    const bobV = await (await createVersion(bob.boardId, { name: "b" })).json();
    actAs(alice);
    const { POST } = await import("@/app/api/versions/[id]/release/route");
    expect((await POST(req("POST", { moveUnresolvedTo: bobV.id }), ctx(v1.id))).status).toBe(404);
    expect((await POST(req("POST", { moveUnresolvedTo: v1.id }), ctx(v1.id))).status).toBe(400);
  });

  it("unreleasing clears the stamp", async () => {
    const v1 = await (await createVersion(alice.boardId, { name: "v1" })).json();
    await (await import("@/app/api/versions/[id]/release/route")).POST(req("POST", {}), ctx(v1.id));
    await (await import("@/app/api/versions/[id]/route")).PATCH(req("PATCH", { released: false }), ctx(v1.id));
    const [row] = await db.select().from(versions).where(eq(versions.id, v1.id));
    expect(row.releasedAt).toBeNull();
  });
});
