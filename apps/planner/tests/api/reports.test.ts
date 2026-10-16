import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, sprintReports, sprints } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { createdVsResolved, velocityFrom } from "@/lib/reports";

/**
 * FAILING-FIRST reports.
 *
 * Velocity is the honest part: what a sprint contained is only knowable while it is running, because
 * completing it sends unfinished cards back to the backlog. So completing a sprint writes a snapshot
 * (committed and completed, in points and cards), and velocity reads those snapshots rather than
 * guessing from today's membership.
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

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  identity.sub = alice.sub; identity.email = alice.email;
});

afterAll(async () => {
  await closeDb();
});

describe("completing a sprint snapshots what it contained", () => {
  it("records committed and completed, in points and cards", async () => {
    const [done] = await db.insert(cards).values({
      listId: alice.listId, boardId: alice.boardId, title: "done work", position: 2,
      sprintId: alice.sprintId, points: 5, isComplete: true, completedAt: new Date(),
    }).returning();
    await db.insert(cards).values({
      listId: alice.listId, boardId: alice.boardId, title: "rolled over", position: 3,
      sprintId: alice.sprintId, points: 3,
    });
    await db.update(sprints).set({ state: "active", startDate: new Date() }).where(eq(sprints.id, alice.sprintId));

    const { PATCH } = await import("@/app/api/sprints/[id]/route");
    const res = await PATCH(req("PATCH", { state: "completed" }), ctx(alice.sprintId));
    expect(res.status).toBe(200);

    const [snap] = await db.select().from(sprintReports).where(eq(sprintReports.sprintId, alice.sprintId));
    expect(snap).toMatchObject({
      committedPoints: 8, completedPoints: 5, committedCards: 2, completedCards: 1, returnedCards: 1,
    });
    // and the rolled-over card really did go back to the backlog
    const [rolled] = await db.select().from(cards).where(eq(cards.title, "rolled over"));
    expect(rolled.sprintId).toBeNull();
    expect((await db.select().from(cards).where(eq(cards.id, done.id)))[0].sprintId).toBe(alice.sprintId);
  });

  it("re-completing a sprint does not add a second snapshot", async () => {
    await db.update(sprints).set({ state: "active" }).where(eq(sprints.id, alice.sprintId));
    const { PATCH } = await import("@/app/api/sprints/[id]/route");
    await PATCH(req("PATCH", { state: "completed" }), ctx(alice.sprintId));
    await PATCH(req("PATCH", { state: "future" }), ctx(alice.sprintId));
    await PATCH(req("PATCH", { state: "completed" }), ctx(alice.sprintId));
    expect(await db.select().from(sprintReports).where(eq(sprintReports.sprintId, alice.sprintId))).toHaveLength(1);
  });
});

describe("the reports endpoint", () => {
  it("returns velocity, created vs resolved and throughput for a board the caller can see", async () => {
    await db.update(sprints).set({ state: "active" }).where(eq(sprints.id, alice.sprintId));
    await (await import("@/app/api/sprints/[id]/route")).PATCH(req("PATCH", { state: "completed" }), ctx(alice.sprintId));

    const { GET } = await import("@/app/api/boards/[id]/reports/route");
    const body = await (await GET(req("GET"), ctx(alice.boardId))).json();
    expect(body.velocity).toHaveLength(1);
    expect(body.createdVsResolved.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("throughput");
  });

  it("another tenant gets 404", async () => {
    const bob = await seedTenant("bob");
    identity.sub = bob.sub; identity.email = bob.email;
    const { GET } = await import("@/app/api/boards/[id]/reports/route");
    expect((await GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("pure report maths", () => {
  it("velocity averages only completed sprints, newest last", () => {
    const v = velocityFrom([
      { name: "S1", committedPoints: 10, completedPoints: 8, completedAt: new Date("2026-09-01") },
      { name: "S2", committedPoints: 12, completedPoints: 12, completedAt: new Date("2026-09-15") },
    ]);
    expect(v.sprints.map((s) => s.name)).toEqual(["S1", "S2"]);
    expect(v.averageCompleted).toBe(10);
  });

  it("velocity of nothing is zero, not NaN", () => {
    expect(velocityFrom([]).averageCompleted).toBe(0);
  });

  it("created vs resolved buckets by week and counts both", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const rows = createdVsResolved(
      [
        { createdAt: new Date("2026-09-16"), completedAt: new Date("2026-09-17") },
        { createdAt: new Date("2026-09-10"), completedAt: null },
        { createdAt: new Date("2026-08-01"), completedAt: new Date("2026-09-16") },   // created before the window
      ],
      4, now,
    );
    expect(rows).toHaveLength(4);
    const last = rows.at(-1)!;
    expect(last.created).toBe(1);
    expect(last.resolved).toBe(2);
    expect(rows.reduce((n, r) => n + r.created, 0)).toBe(2);   // the August card is outside the window
  });
});
