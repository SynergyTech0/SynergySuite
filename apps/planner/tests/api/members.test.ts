import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { visibleBoardIds } from "@/lib/authz";

/**
 * FAILING-FIRST board membership tests (P1a).
 *
 * The product cannot onboard a second person. board_members and workspace_members exist in the
 * schema, but the ONLY code anywhere that writes to them is app/api/boards/route.ts POST, inserting
 * the creator as owner. There is no route — and no UI — by which anyone else is ever granted access
 * to a board. Since every read is now scoped by membership, that means collaboration is impossible
 * except by direct SQL.
 *
 * These describe the required behaviour of /api/boards/[id]/members and are expected to fail with
 * module-not-found until that route exists.
 *
 * Conventions asserted here:
 *  - A board the caller cannot see answers 404 (never 403) — a 403 would confirm it exists.
 *  - A board the caller CAN see but lacks the role to administer answers 403. That leaks nothing:
 *    they already know the board exists.
 *  - Only owner/admin may grant, change or revoke membership. app/api/cards/[id]/members/route.ts
 *    deliberately does NOT check the caller's role, which is right for assigning someone to a card
 *    and wrong for granting access to the board itself.
 */

const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-user": identity.sub,
      "x-forwarded-email": identity.email,
    }),
}));

function actAs(who: { sub: string; email: string }) {
  identity.sub = who.sub;
  identity.email = who.email;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/**
 * A second human inside an existing tenant's workspace — deliberately NOT a board member, so these
 * tests can prove that granting board membership is what changes their access.
 */
async function addWorkspacePeer(
  workspaceId: string,
  slug: string,
  role: "owner" | "admin" | "member" | "observer" = "member",
) {
  const [user] = await db
    .insert(users)
    .values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: `User ${slug}` })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role });
  return { userId: user.id, sub: user.authSub!, email: user.email!, name: user.name };
}

let alice: Tenant;
let bob: Tenant;
let carol: Awaited<ReturnType<typeof addWorkspacePeer>>;

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  bob = await seedTenant("bob");
  carol = await addWorkspacePeer(alice.workspaceId, "carol"); // alice's workspace, not on her board
  actAs(alice);
});

afterAll(async () => {
  await closeDb();
});

describe("listing board members", () => {
  it("lists the members of a board the caller belongs to", async () => {
    const { GET } = await import("@/app/api/boards/[id]/members/route");
    const res = await GET(req("GET"), ctx(alice.boardId));

    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { userId: string }) => r.userId)).toEqual([alice.userId]);
    expect(rows[0].role).toBe("owner");
  });

  it("refuses to list members of another tenant's board", async () => {
    actAs(bob);
    const { GET } = await import("@/app/api/boards/[id]/members/route");

    expect((await GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
  });
});

describe("granting board membership", () => {
  it("adds a workspace peer, and that ACTUALLY grants them access to the board", async () => {
    const { POST } = await import("@/app/api/boards/[id]/members/route");

    // Precondition: the whole point of the feature. Carol shares the workspace, so she can already
    // see the board that way — assert the board-member row is what we add, then prove access holds.
    const before = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, carol.userId)));
    expect(before).toHaveLength(0);

    const res = await POST(req("POST", { userId: carol.userId, role: "member" }), ctx(alice.boardId));
    expect(res.status).toBe(201);

    const after = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, carol.userId)));
    expect(after).toHaveLength(1);
    expect(after[0].role).toBe("member");

    // Deliberately NOT asserted: that this changed carol's visibility. It did not — she already saw
    // the board through workspace membership, and visibleBoardIds() is board-members UNION
    // workspace-members. What the board_members row establishes is her ROLE on the board, which is
    // what role-gated actions key off. Asserting visibility here would pass without the feature.
  });

  it("refuses to add a stranger from another tenant", async () => {
    const { POST } = await import("@/app/api/boards/[id]/members/route");
    const res = await POST(req("POST", { userId: bob.userId }), ctx(alice.boardId));

    expect(res.status).toBe(404);
    expect(await visibleBoardIds(bob.userId)).not.toContain(alice.boardId);
  });

  it("refuses when the caller is not a member of the board at all", async () => {
    actAs(bob);
    const { POST } = await import("@/app/api/boards/[id]/members/route");
    const res = await POST(req("POST", { userId: bob.userId }), ctx(alice.boardId));

    expect(res.status).toBe(404);
    expect(await visibleBoardIds(bob.userId)).not.toContain(alice.boardId);
  });

  it("refuses when the caller is a plain member rather than owner/admin", async () => {
    // Carol joins as a plain member, then tries to grant membership to someone else.
    await db.insert(boardMembers).values({
      boardId: alice.boardId, userId: carol.userId, role: "member",
    });
    const dave = await addWorkspacePeer(alice.workspaceId, "dave");
    actAs(carol);

    const { POST } = await import("@/app/api/boards/[id]/members/route");
    const res = await POST(req("POST", { userId: dave.userId }), ctx(alice.boardId));

    expect(res.status).toBe(403);
    // Assert on the board_members row, not on visibility: dave is a workspace peer, so he can see
    // this board regardless, and a visibility assertion would fail even when the route is correct.
    expect(
      await db
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, dave.userId))),
    ).toHaveLength(0);
  });
});

describe("roles inherited from the workspace", () => {
  it("a workspace owner with no board_members row can still administer the board", async () => {
    // Otherwise the owner of a workspace is locked out of administering a board inside it purely
    // because they never explicitly joined that board.
    const erin = await addWorkspacePeer(alice.workspaceId, "erin", "owner");
    const dave = await addWorkspacePeer(alice.workspaceId, "dave");
    actAs(erin);

    const { POST } = await import("@/app/api/boards/[id]/members/route");
    const res = await POST(req("POST", { userId: dave.userId }), ctx(alice.boardId));

    expect(res.status).toBe(201);
  });

  it("a plain workspace member with no board_members row cannot administer it", async () => {
    // Carol can SEE this board — workspace membership grants that — so a refusal here has to come
    // from effectiveRole() resolving her to null rather than inheriting anything from the
    // workspace. This is what distinguishes "correctly resolved as unprivileged" from "role lookup
    // returns nothing for everybody", which the role-gate tests alone cannot tell apart.
    const dave = await addWorkspacePeer(alice.workspaceId, "dave");
    actAs(carol);

    const { POST } = await import("@/app/api/boards/[id]/members/route");
    const res = await POST(req("POST", { userId: dave.userId }), ctx(alice.boardId));

    expect(res.status).toBe(403);
  });
});

describe("changing a role and revoking membership", () => {
  beforeEach(async () => {
    await db.insert(boardMembers).values({
      boardId: alice.boardId, userId: carol.userId, role: "member",
    });
  });

  it("an owner can promote a member to admin", async () => {
    const { PATCH } = await import("@/app/api/boards/[id]/members/route");
    const res = await PATCH(req("PATCH", { userId: carol.userId, role: "admin" }), ctx(alice.boardId));

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, carol.userId)));
    expect(row.role).toBe("admin");
  });

  it("a plain member cannot promote themselves", async () => {
    actAs(carol);
    const { PATCH } = await import("@/app/api/boards/[id]/members/route");
    const res = await PATCH(req("PATCH", { userId: carol.userId, role: "owner" }), ctx(alice.boardId));

    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, carol.userId)));
    expect(row.role).toBe("member");
  });

  it("an owner can revoke a member, removing their board-member access", async () => {
    const { DELETE } = await import("@/app/api/boards/[id]/members/route");
    const res = await DELETE(req("DELETE", { userId: carol.userId }), ctx(alice.boardId));

    expect(res.status).toBe(200);
    expect(
      await db
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, carol.userId))),
    ).toHaveLength(0);
  });

  it("refuses to remove the last owner, so a board cannot be orphaned", async () => {
    const { DELETE } = await import("@/app/api/boards/[id]/members/route");
    const res = await DELETE(req("DELETE", { userId: alice.userId }), ctx(alice.boardId));

    expect(res.status).toBe(409);
    expect(
      await db
        .select()
        .from(boardMembers)
        .where(and(eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, alice.userId))),
    ).toHaveLength(1);
  });
});
