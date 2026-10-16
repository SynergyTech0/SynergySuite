import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";
import type { PolicyClient, SearchResponse } from "@synergy/compliance";

// Runs against a real Postgres when TEST_DATABASE_URL is set. It uses a database of its own next
// to that one ("<name>_compliance"), so it can run alongside todo.test.ts.
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
const today = "2026-10-16";

const held = new Set<string>();
const fakePolicy: PolicyClient = {
  onHold: async (e) => held.has(e),
  retention: async () => [],
  retentionDays: async () => null,
  invalidate() {},
};

describe.skipIf(!base)("to do compliance", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const todo = await import("../lib/todo");
  const { q, db } = await import("../lib/db");
  const { setPolicy } = await import("../lib/compliance");
  const searchRoute = await import("../app/api/compliance/search/route");
  const exportRoute = await import("../app/api/compliance/export/route");

  const call = (route: { POST: (req: Request) => Promise<Response> }, body: unknown, token: string | null = "test-token") =>
    route.POST(
      new Request("http://todo/api/compliance", {
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
  const names = (r: SearchResponse) => r.hits.map((h) => h.title).sort();

  let launch: { id: string };
  let party: { id: string };
  let milk: { id: string };

  beforeAll(async () => {
    setPolicy(fakePolicy);
    await q("TRUNCATE lists CASCADE");
    const project = await todo.createList(alice, "Project");
    await todo.share(alice, project.id, bob);
    launch = await todo.createTask(alice, { listId: project.id, title: "Plan the launch", today });
    await todo.updateTask(alice, launch.id, { notes: "Book the venue for the product launch", assignedTo: bob, today });
    await todo.addStep(alice, launch.id, "Email the caterer");
    party = await todo.createTask(bob, { listId: project.id, title: "Team party", today });
    milk = await todo.createTask(alice, { title: "Buy milk", today });
    await todo.createTask(carol, { title: "Carol's errand", today });
    await q("UPDATE tasks SET modified_at = '2020-01-01T12:00:00Z' WHERE id = $1", [milk.id]);
  });
  afterAll(async () => {
    setPolicy(undefined);
    await db().close();
  });

  it("answers only the Admin center's token", async () => {
    expect((await call(searchRoute, {}, null)).status).toBe(401);
    expect((await call(exportRoute, { ids: [] }, "nope")).status).toBe(401);
    expect((await call(searchRoute, { to: 5 })).status).toBe(400);
    expect((await call(exportRoute, { ids: Array.from({ length: 101 }, (_, i) => String(i)) })).status).toBe(400);
  });

  it("searches by keywords, custodians, dates and kinds", async () => {
    expect(names(await search({}))).toEqual(["Buy milk", "Carol's errand", "Plan the launch", "Team party"]);
    expect(names(await search({ query: "caterer" }))).toEqual(["Plan the launch"]);
    expect(names(await search({ query: "project -launch" }))).toEqual(["Team party"]);
    expect(names(await search({ query: "milk OR errand" }))).toEqual(["Buy milk", "Carol's errand"]);
    // Bob is on the shared list: he is a participant on its tasks, and the one he made is still Alice's.
    const forBob = await search({ custodians: [bob] });
    expect(names(forBob)).toEqual(["Plan the launch", "Team party"]);
    expect(forBob.hits.every((h) => h.owner === alice && h.participants?.includes(bob))).toBe(true);
    expect(names(await search({ custodians: [carol] }))).toEqual(["Carol's errand"]);
    expect(names(await search({ custodians: [alice], to: "2020-12-31" }))).toEqual(["Buy milk"]);
    expect(names(await search({ custodians: [alice], from: "2021-01-01" }))).toEqual(["Plan the launch", "Team party"]);
    expect(names(await search({ kinds: ["contact"] }))).toEqual([]);
    const first = await search({ limit: 3 });
    expect(first.total).toBe(4);
    expect((await search({ limit: 3, cursor: first.nextCursor })).hits).toHaveLength(1);
    expect((await search({ query: "venue" })).hits[0].snippet).toContain("Book the venue");
  });

  it("exports a task with its list, steps and notes", async () => {
    const { items } = await (await call(exportRoute, { ids: [launch.id] })).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ app: "todo", kind: "task", title: "Plan the launch", owner: alice });
    expect(items[0].metadata).toMatchObject({
      list: "Project",
      listMembers: [bob],
      assignedTo: bob,
      notes: "Book the venue for the product launch",
      steps: [{ title: "Email the caterer", done: false, deleted: false }],
    });
    expect(items[0].text).toContain("[ ] Email the caterer");
  });

  it("keeps what is deleted under a hold, hidden but found", async () => {
    held.add(alice);
    const [step] = (await todo.getTask(alice, launch.id, today)).steps;
    await todo.deleteStep(alice, launch.id, step.id);
    expect((await todo.getTask(alice, launch.id, today)).steps).toEqual([]);
    await todo.deleteTask(alice, milk.id);
    await expect(todo.getTask(alice, milk.id, today)).rejects.toThrow(/not found/);
    expect((await todo.tasks(alice, { view: "all", today })).map((t) => t.title)).not.toContain("Buy milk");
    expect((await todo.counts(alice, today)).all).toBe(2);
    expect((await search({ query: "milk" })).hits).toEqual([expect.objectContaining({ id: milk.id, deleted: true })]);

    // A whole list: gone for Alice and Bob, its tasks still found.
    const project = (await todo.lists(alice)).find((l) => l.name === "Project")!;
    await todo.deleteList(alice, project.id);
    expect((await todo.lists(alice)).map((l) => l.name)).toEqual(["Tasks"]);
    expect((await todo.lists(bob)).map((l) => l.name)).toEqual(["Tasks"]);
    await expect(todo.getTask(bob, party.id, today)).rejects.toThrow(/not found/);
    const kept = await search({ custodians: [bob] });
    expect(kept.hits.map((h) => [h.title, h.deleted])).toEqual(expect.arrayContaining([["Plan the launch", true], ["Team party", true]]));
    const { items } = await (await call(exportRoute, { ids: [launch.id] })).json();
    expect(items[0].metadata.steps).toEqual([{ title: "Email the caterer", done: false, deleted: true }]);

    // Nobody else is held: Carol's goes for good.
    const [errand] = await todo.tasks(carol, { view: "all", today });
    await todo.deleteTask(carol, errand.id);
    expect(names(await search({ custodians: [carol] }))).toEqual([]);
    held.clear();
  });

  it("deletes a list for good when nobody on it is held", async () => {
    const list = await todo.createList(carol, "Spare");
    await todo.createTask(carol, { listId: list.id, title: "Spare task", today });
    await todo.deleteList(carol, list.id);
    expect(await q("SELECT 1 FROM lists WHERE id = $1", [list.id])).toEqual([]);
    expect(names(await search({ query: "spare" }))).toEqual([]);
  });
});
