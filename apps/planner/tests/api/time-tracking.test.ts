import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, users, workLogs, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST Jira time tracking: original estimate, remaining estimate and work logs.
 *
 * The rule that makes the numbers mean anything: logging work reduces the remaining estimate by what
 * was logged (Jira's default "adjust automatically"), and never below zero. Estimates are stored as
 * minutes; the wire accepts Jira shorthand ("2h 30m").
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

const patch = async (body: unknown) => (await import("@/app/api/cards/[id]/route")).PATCH(req("PATCH", body), ctx(alice.cardId));
const log = async (body: unknown) => (await import("@/app/api/cards/[id]/worklog/route")).POST(req("POST", body), ctx(alice.cardId));
const card = async () => (await db.select().from(cards).where(eq(cards.id, alice.cardId)))[0];

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

describe("estimates", () => {
  it("accepts Jira shorthand and stores minutes; setting the original seeds the remaining", async () => {
    expect((await patch({ originalEstimate: "1d 4h" })).status).toBe(200);
    expect(await card()).toMatchObject({ originalEstimate: 720, remainingEstimate: 720 });
  });

  it("does not re-seed the remaining estimate once work has been logged", async () => {
    await patch({ originalEstimate: "4h" });
    await log({ spent: "1h" });
    await patch({ originalEstimate: "6h" });
    const c = await card();
    expect(c.originalEstimate).toBe(360);
    expect(c.remainingEstimate).toBe(180);   // 4h - 1h logged, untouched by the new original
  });

  it("clears both with null, and refuses nonsense", async () => {
    await patch({ originalEstimate: "2h" });
    await patch({ originalEstimate: null });
    expect(await card()).toMatchObject({ originalEstimate: null, remainingEstimate: null });
    expect((await patch({ originalEstimate: "later" })).status).toBe(400);
    expect((await patch({ remainingEstimate: "-3h" })).status).toBe(400);
  });
});

describe("work logs", () => {
  it("logging work records who, how long and when, and reduces the remaining estimate", async () => {
    await patch({ originalEstimate: "8h" });
    const res = await log({ spent: "2h 30m", comment: "pairing on the migration" });
    expect(res.status).toBe(201);
    const [entry] = await db.select().from(workLogs);
    expect(entry).toMatchObject({ minutes: 150, userId: alice.userId, comment: "pairing on the migration" });
    const c = await card();
    expect(c.timeSpent).toBe(150);
    expect(c.remainingEstimate).toBe(330);
  });

  it("never drives the remaining estimate below zero", async () => {
    await patch({ originalEstimate: "1h" });
    await log({ spent: "3h" });
    expect(await card()).toMatchObject({ timeSpent: 180, remainingEstimate: 0 });
  });

  it("an explicit remaining estimate on the log wins (Jira's 'set to')", async () => {
    await patch({ originalEstimate: "8h" });
    await log({ spent: "1h", remaining: "2h" });
    expect(await card()).toMatchObject({ timeSpent: 60, remainingEstimate: 120 });
  });

  it("deleting a log entry gives the time back", async () => {
    await patch({ originalEstimate: "8h" });
    await log({ spent: "2h" });
    const [entry] = await db.select().from(workLogs);
    const { DELETE } = await import("@/app/api/worklog/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(entry.id))).status).toBe(200);
    expect(await card()).toMatchObject({ timeSpent: 0, remainingEstimate: 480 });
  });

  it("only the author or an admin can delete an entry", async () => {
    await log({ spent: "1h" });
    const [entry] = await db.select().from(workLogs);
    const [carol] = await db.insert(users).values({ authSub: "sub-carol", email: "carol@example.com", name: "carol" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: carol.id, role: "member" });
    actAs({ sub: "sub-carol", email: "carol@example.com" });
    const { DELETE } = await import("@/app/api/worklog/[id]/route");
    expect((await DELETE(req("DELETE"), ctx(entry.id))).status).toBe(403);
  });

  it("card detail carries the log with author names and the totals", async () => {
    await patch({ originalEstimate: "4h" });
    await log({ spent: "45m" });
    const detail = await (await (await import("@/app/api/cards/[id]/route")).GET(req("GET"), ctx(alice.cardId))).json();
    expect(detail.workLogs[0]).toMatchObject({ minutes: 45, author: "User alice" });
    expect(detail).toMatchObject({ originalEstimate: 240, remainingEstimate: 195, timeSpent: 45 });
  });

  it("an observer cannot log work, and another tenant gets 404", async () => {
    const [olly] = await db.insert(users).values({ authSub: "sub-olly", email: "olly@example.com", name: "olly" }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: alice.workspaceId, userId: olly.id, role: "observer" });
    actAs({ sub: "sub-olly", email: "olly@example.com" });
    expect((await log({ spent: "1h" })).status).toBe(403);
    actAs(bob);
    expect((await log({ spent: "1h" })).status).toBe(404);
  });

  it("refuses an empty or unparseable amount", async () => {
    expect((await log({ spent: "" })).status).toBe(400);
    expect((await log({ spent: "ages" })).status).toBe(400);
    expect(await db.select().from(workLogs)).toHaveLength(0);
  });
});
