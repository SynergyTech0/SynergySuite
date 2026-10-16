import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * FAILING-FIRST page-level tenancy tests (T0).
 *
 * tests/api/tenancy.test.ts locks down all 20 JSON routes — and every one of them correctly answers
 * 404 for a foreign board. The server components that RENDER those boards were never covered, and
 * they resolve boards straight from the database with no membership check at all. Measured against a
 * running dev server, the same board id at the same moment:
 *
 *     GET /api/boards/<foreign-id>   -> 404 {"error":"not found"}
 *     GET /api/stream/<foreign-id>   -> 404
 *     GET /b/<foreign-id>            -> 200, renders the board, its lists and its cards
 *
 * The index page is worse: it selects every non-closed board in the table, so it enumerates every
 * tenant. These tests describe the required behaviour and are expected to fail until the three page
 * components go through lib/authz.ts.
 *
 * Same convention as the API tests: refuse by 404 (notFound()), never 403.
 */

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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Deep-search what a server component returned for a string — used to prove a foreign tenant's data
 * never reaches the markup, without pulling in a DOM renderer for what is a pure data-scoping
 * question.
 *
 * It must descend into plain objects, not just `props`: the board page returns
 * `<Board board={...} initialCards={...} />`, so the titles and card text we care about sit inside
 * ordinary data props rather than as element children. An earlier version only walked `node.props`
 * and so reported false for everything on that page — which made the "does not leak a foreign
 * board's cards" assertion pass while asserting nothing at all.
 */
function treeContains(node: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.includes(needle);
  if (typeof node === "number") return String(node).includes(needle);
  if (typeof node !== "object") return false;
  if (seen.has(node)) return false; // React elements self-reference; don't recurse forever
  seen.add(node);
  if (Array.isArray(node)) return node.some((n) => treeContains(n, needle, seen));
  return Object.entries(node as Record<string, unknown>)
    .filter(([k]) => k !== "_owner" && k !== "_store") // React internals, not rendered content
    .some(([, v]) => treeContains(v, needle, seen));
}

let alice: Tenant;
let bob: Tenant;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  actAs(bob); // Bob is the attacker: a real signed-in user of another workspace
});

afterAll(async () => {
  await closeDb();
});

describe("server-rendered pages refuse a board the caller is not a member of", () => {
  it("the board page refuses another tenant's board", async () => {
    const { default: BoardPage } = await import("@/app/b/[id]/page");

    await expect(BoardPage(ctx(alice.boardId))).rejects.toThrow();
  });

  it("the backlog page refuses another tenant's board", async () => {
    const { default: BacklogPage } = await import("@/app/b/[id]/backlog/page");

    await expect(BacklogPage(ctx(alice.boardId))).rejects.toThrow();
  });

  it("the releases page refuses another tenant's board", async () => {
    const { default: ReleasesPage } = await import("@/app/b/[id]/releases/page");

    await expect(ReleasesPage(ctx(alice.boardId))).rejects.toThrow();
  });

  it("the board page does not leak a foreign board's cards into the markup", async () => {
    const { default: BoardPage } = await import("@/app/b/[id]/page");

    // Either it refuses, or — if it ever renders — it must not contain alice's data. Asserting on
    // the outcome rather than the mechanism keeps this honest if the refusal style changes.
    const rendered = await BoardPage(ctx(alice.boardId)).catch(() => null);
    expect(rendered === null || !treeContains(rendered, "alice card")).toBe(true);
  });
});

describe("the boards index lists only the caller's boards", () => {
  it("does not enumerate another tenant's boards", async () => {
    const { default: Home } = await import("@/app/page");

    const rendered = await Home();
    expect(treeContains(rendered, "alice board")).toBe(false);
  });

  it("still shows the caller's own board", async () => {
    const { default: Home } = await import("@/app/page");

    const rendered = await Home();
    expect(treeContains(rendered, "bob board")).toBe(true);
  });
});

describe("a member keeps full access to their own board", () => {
  it("renders their own board page", async () => {
    const { default: BoardPage } = await import("@/app/b/[id]/page");

    const rendered = await BoardPage(ctx(bob.boardId));
    expect(treeContains(rendered, "bob board")).toBe(true);
  });

  it("renders their own backlog page", async () => {
    const { default: BacklogPage } = await import("@/app/b/[id]/backlog/page");

    const rendered = await BacklogPage(ctx(bob.boardId));
    expect(treeContains(rendered, "bob board")).toBe(true);
  });
});
