import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@synergy/db";

// Runs against a real Postgres when TEST_DATABASE_URL is set, in a database of its own
// ("<name>_planner") so it can run alongside the other test files.
const base = process.env.TEST_DATABASE_URL;

async function ownDatabase(url: string): Promise<string> {
  const u = new URL(url);
  const name = `${u.pathname.slice(1)}_planner`;
  const admin = createDb({ connectionString: url, max: 1 });
  if (!(await admin.q("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.q(`CREATE DATABASE "${name}"`);
  await admin.close();
  u.pathname = `/${name}`;
  return u.toString();
}

const alice = { email: "alice@example.com", name: "Alice", subject: "sub-alice" };
const BOARD = "11111111-2222-4333-8444-555555555555";

describe.skipIf(!base)("planner link", async () => {
  if (base) process.env.DATABASE_URL = await ownDatabase(base);
  const projects = await import("../lib/projects");
  const planner = await import("../lib/planner");
  const { q, db } = await import("../lib/db");

  const asked: { url: string; headers: Record<string, string> }[] = [];
  let cards = [
    { id: "c1", title: "Set up CI", issueKey: "WEB-1", listId: "l1", startDate: "2026-10-12T00:00:00Z", dueDate: "2026-10-14T00:00:00Z", originalEstimate: 240, isComplete: false },
    { id: "c2", title: "Ship it", listId: "l2", dueDate: "2026-10-20T00:00:00Z", isComplete: false },
  ];

  beforeAll(async () => {
    await q("TRUNCATE projects CASCADE");
    planner.setPlannerFetch((async (url: string, init: RequestInit) => {
      asked.push({ url, headers: init.headers as Record<string, string> });
      if (url.endsWith("/api/boards")) return Response.json([{ id: BOARD, title: "Website" }]);
      if (url.endsWith(`/api/boards/${BOARD}`)) return Response.json({ board: { id: BOARD }, lists: [{ id: "l1", title: "Doing" }, { id: "l2", title: "Later" }], cards });
      return new Response("{}", { status: 404 });
    }) as typeof fetch);
  });
  afterAll(async () => {
    planner.setPlannerFetch(undefined);
    await db().close();
  });

  it("lists the person's boards, asking Planner as them", async () => {
    expect(await planner.plannerBoards(alice)).toEqual([{ id: BOARD, title: "Website" }]);
    expect(asked[0].headers["x-auth-request-email"]).toBe(alice.email);
  });

  it("brings cards in as tasks under their lists, and updates them on the next sync", async () => {
    const p = await projects.createProject(alice.email, { name: "Web", plannerBoardId: BOARD });
    const first = await planner.syncFromPlanner(alice, p.id);
    expect([first.added, first.updated]).toEqual([2, 0]);
    expect(first.tasks.map((t) => [t.wbs, t.title, t.start, t.finish, t.estimateMinutes])).toEqual([
      ["1", "Doing", "2026-10-12", "2026-10-14", 240],
      ["1.1", "WEB-1 Set up CI", "2026-10-12", "2026-10-14", 240],
      ["2", "Later", "2026-10-20", "2026-10-20", null],
      ["2.1", "Ship it", "2026-10-20", "2026-10-20", null],
    ]);
    cards = [{ ...cards[0], isComplete: true }, cards[1]];
    const again = await planner.syncFromPlanner(alice, p.id);
    expect([again.added, again.updated]).toEqual([0, 2]);
    expect(again.tasks.find((t) => t.plannerCardId === "c1")?.percentDone).toBe(100);
    const links = await planner.plannerLinks(alice.email, p.id);
    expect(links.board).toMatch(new RegExp(`/b/${BOARD}$`));
    expect(Object.values(links.cards)).toContain(`${links.board}?card=c1`);
  });

  it("needs a linked board", async () => {
    const p = await projects.createProject(alice.email, { name: "Unlinked" });
    await expect(planner.syncFromPlanner(alice, p.id)).rejects.toThrow(/Link a Planner board/);
    await expect(projects.updateProject(alice.email, p.id, { plannerBoardId: "not-a-board" })).rejects.toThrow(/Pick a Planner board/);
  });
});
