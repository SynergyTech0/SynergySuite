import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside projects.test.ts.
const base = process.env.TEST_DATABASE_URL;
process.env.COMPLIANCE_TOKEN = "test-token";

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_compliance`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("projects compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const projects = await import("../lib/projects");
  const time = await import("../lib/time");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://projects/api/compliance", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const search = async (body: Record<string, unknown>) => {
    const res = await call(searchRoute, body);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResponse;
  };
  const kinds = (r: SearchResponse) => r.hits.map((h) => h.kind).sort();

  let projectId = "";
  let taskId = "";
  let expenseId = "";

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE projects CASCADE");
    const p = await projects.createProject(alice, { name: "Harbor survey", clientName: "Port authority", description: "Survey of the north pier" });
    projectId = p.id;
    await projects.setMember(alice, p.id, { email: bob });
    taskId = (await projects.createTask(alice, p.id, { title: "Dive inspection", notes: "Check the pilings", assignedTo: bob })).id;
    await time.setCell(bob, { projectId, taskId, day: "2026-10-14", hours: 3, notes: "Pilings 1-12 inspected" });
    const x = await time.createExpense(bob, { projectId, day: "2026-10-14", category: "Supplies", description: "Dive tanks", amount: "40" });
    expenseId = x.id;
    await time.setReceipt(bob, x.id, { name: "tanks.pdf", type: "application/pdf", bytes: Buffer.from("%PDF") });
    await projects.createProject(carol, { name: "Carol's own" });
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { to: 5 })).status).toBe(400);
  });

  it("searches projects, tasks, time and expenses by person and words", async () => {
    expect(kinds(await search({}))).toEqual(["expense", "project", "project", "task", "time"]);
    // Bob logged the time and the expense, and is on the team and the task.
    const forBob = await search({ custodians: [bob] });
    expect(kinds(forBob)).toEqual(["expense", "project", "task", "time"]);
    expect(forBob.hits.find((h) => h.kind === "time")?.owner).toBe(bob);
    expect(forBob.hits.find((h) => h.kind === "project")?.participants).toEqual([bob]);
    expect(kinds(await search({ query: "pilings" }))).toEqual(["task", "time"]);
    expect(kinds(await search({ kinds: ["expense"] }))).toEqual(["expense"]);
    expect((await search({ custodians: [carol] })).hits.map((h) => h.title)).toEqual([expect.stringMatching(/Carol's own$/)]);
  });

  it("exports an expense with its receipt", async () => {
    const { items } = await (await call(exportRoute, { ids: [expenseId, taskId] })).json();
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(["expense", "task"]);
    expect(items[0]).toMatchObject({ app: "projects", owner: bob, metadata: { category: "Supplies", receiptName: "tanks.pdf" } });
    expect(items[0].attachments[0]).toMatchObject({ name: "tanks.pdf", type: "application/pdf", base64: Buffer.from("%PDF").toString("base64") });
    expect(items[1].metadata).toMatchObject({ title: "Dive inspection", assigned_to: bob });
  });

  it("keeps what is deleted under a hold, hidden but found", async () => {
    held.add(bob);
    await time.setCell(bob, { projectId, taskId, day: "2026-10-14", hours: 0 });
    await time.deleteExpense(bob, expenseId);
    expect((await time.timesheet(bob, "2026-10-14")).rows).toEqual([]);
    expect(await time.myExpenses(bob)).toEqual([]);
    const found = await search({ custodians: [bob], kinds: ["time", "expense"] });
    expect(found.hits.every((h) => h.deleted)).toBe(true);
    expect(found.hits).toHaveLength(2);
    // The same cell can be filled in again while the kept one stays hidden.
    await time.setCell(bob, { projectId, taskId, day: "2026-10-14", hours: 1 });
    expect((await time.timesheet(bob, "2026-10-14")).totalMinutes).toBe(60);

    await projects.deleteProject(alice, projectId);
    expect(await projects.listProjects(alice, "2026-10-16")).toEqual([]);
    expect((await search({ custodians: [alice], kinds: ["project"] })).hits[0].deleted).toBe(true);
    held.clear();
  });
});
