import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, boards, invites, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";
import { visibleBoardIds } from "@/lib/authz";

/**
 * FAILING-FIRST invitation tests (P1b) — the half that actually fixes onboarding.
 *
 * Board member administration (P1a) only grants a ROLE to someone who already shares the workspace.
 * But ownWorkspace() puts every new user in their OWN workspace, and visibleBoardIds() is
 * board-members UNION workspace-members — so there is never anyone to promote. Until an invite can
 * put a NEW person into an existing workspace, this product is single-player by construction.
 *
 * Expected to fail with module-not-found until the routes exist.
 *
 * Security properties asserted here, not just the happy path:
 *  - the token is the credential, so accepting is only ever by token, never by invite id;
 *  - an invite cannot be used twice, after expiry, or after revocation;
 *  - accepting binds to the ACCEPTING user, so a leaked link cannot be redeemed by a third party
 *    into someone else's account;
 *  - only owner/admin may invite — same role gate as P1a, or an observer invites themselves help.
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

/** A person who exists in SynergyAuth but is in NO workspace — the realistic invitee. */
async function outsider(slug: string) {
  const [user] = await db
    .insert(users)
    .values({ authSub: `sub-${slug}`, email: `${slug}@example.com`, name: `User ${slug}` })
    .returning();
  return { userId: user.id, sub: user.authSub!, email: user.email!, name: user.name };
}

async function inviteRow(token: string) {
  const [row] = await db.select().from(invites).where(eq(invites.token, token));
  return row;
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

describe("creating an invitation", () => {
  it("an owner can invite an email that has no user row yet", async () => {
    const { POST } = await import("@/app/api/boards/[id]/invites/route");
    const res = await POST(req("POST", { email: "newcomer@example.com" }), ctx(alice.boardId));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeTruthy();

    const row = await inviteRow(body.token);
    expect(row.workspaceId).toBe(alice.workspaceId);
    expect(row.boardId).toBe(alice.boardId);
    expect(row.email).toBe("newcomer@example.com");
    expect(row.acceptedAt).toBeNull();
    expect(new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to invite to another tenant's board", async () => {
    actAs(bob);
    const { POST } = await import("@/app/api/boards/[id]/invites/route");
    const res = await POST(req("POST", { email: "newcomer@example.com" }), ctx(alice.boardId));

    expect(res.status).toBe(404);
    expect(await db.select().from(invites)).toHaveLength(0);
  });

  it("refuses when the caller can see the board but is only a plain member", async () => {
    const carol = await outsider("carol");
    await db.insert(workspaceMembers).values({
      workspaceId: alice.workspaceId, userId: carol.userId, role: "member",
    });
    await db.insert(boardMembers).values({
      boardId: alice.boardId, userId: carol.userId, role: "member",
    });
    actAs(carol);

    const { POST } = await import("@/app/api/boards/[id]/invites/route");
    const res = await POST(req("POST", { email: "newcomer@example.com" }), ctx(alice.boardId));

    expect(res.status).toBe(403);
    expect(await db.select().from(invites)).toHaveLength(0);
  });

  it("issues a distinct token per invitation", async () => {
    const { POST } = await import("@/app/api/boards/[id]/invites/route");
    const a = await (await POST(req("POST", { email: "one@example.com" }), ctx(alice.boardId))).json();
    const b = await (await POST(req("POST", { email: "two@example.com" }), ctx(alice.boardId))).json();

    expect(a.token).not.toBe(b.token);
  });
});

describe("accepting an invitation", () => {
  async function anInvite(email = "newcomer@example.com") {
    const { POST } = await import("@/app/api/boards/[id]/invites/route");
    return (await (await POST(req("POST", { email }), ctx(alice.boardId))).json()).token as string;
  }

  it("puts the accepting user into the workspace and ACTUALLY grants board access", async () => {
    const token = await anInvite();
    const newcomer = await outsider("newcomer");

    // The precondition that makes this test meaningful: before accepting, they see nothing.
    expect(await visibleBoardIds(newcomer.userId)).not.toContain(alice.boardId);

    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");
    const res = await POST(req("POST", { token }));

    expect(res.status).toBe(200);
    expect(await visibleBoardIds(newcomer.userId)).toContain(alice.boardId);

    const [ws] = await db
      .select()
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, alice.workspaceId),
        eq(workspaceMembers.userId, newcomer.userId),
      ));
    expect(ws).toBeTruthy();
  });

  it("records who accepted it, and cannot be redeemed twice", async () => {
    const token = await anInvite();
    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");

    expect((await POST(req("POST", { token }))).status).toBe(200);

    const row = await inviteRow(token);
    expect(row.acceptedBy).toBe(newcomer.userId);
    expect(row.acceptedAt).not.toBeNull();

    // A replayed link must not work, even for the same person.
    expect((await POST(req("POST", { token }))).status).toBe(409);
  });

  it("binds to the accepting user, so a leaked link cannot be redeemed into another account", async () => {
    const token = await anInvite("intended@example.com");
    const interloper = await outsider("interloper");
    actAs(interloper);

    const { POST } = await import("@/app/api/invites/accept/route");
    const res = await POST(req("POST", { token }));

    // Whatever the policy (refuse, or bind to the redeemer), the invariant is that the intended
    // address is never silently credited to a different account.
    const row = await inviteRow(token);
    if (res.status === 200) {
      expect(row.acceptedBy).toBe(interloper.userId);
    } else {
      expect(row.acceptedAt).toBeNull();
      expect(await visibleBoardIds(interloper.userId)).not.toContain(alice.boardId);
    }
  });

  it("refuses an expired invitation", async () => {
    const token = await anInvite();
    await db.update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.token, token));

    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");

    expect((await POST(req("POST", { token }))).status).toBe(410);
    expect(await visibleBoardIds(newcomer.userId)).not.toContain(alice.boardId);
  });

  it("refuses a revoked invitation", async () => {
    const token = await anInvite();
    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.token, token));

    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");

    expect((await POST(req("POST", { token }))).status).toBe(410);
    expect(await visibleBoardIds(newcomer.userId)).not.toContain(alice.boardId);
  });

  it("refuses an unknown token without revealing anything", async () => {
    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");

    expect((await POST(req("POST", { token: "not-a-real-token" }))).status).toBe(404);
  });
});

describe("listing and revoking invitations", () => {
  it("lists pending invitations for a board the caller administers", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    await create.POST(req("POST", { email: "pending@example.com" }), ctx(alice.boardId));

    const res = await create.GET(req("GET"), ctx(alice.boardId));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.map((r: { email: string }) => r.email)).toEqual(["pending@example.com"]);
    // The token is the credential — listing must never hand it back out.
    expect(rows[0].token).toBeUndefined();
  });

  it("refuses to list another tenant's invitations", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    await create.POST(req("POST", { email: "pending@example.com" }), ctx(alice.boardId));

    actAs(bob);
    expect((await create.GET(req("GET"), ctx(alice.boardId))).status).toBe(404);
  });

  it("an owner can revoke a pending invitation, and it then cannot be accepted", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    const token = (await (await create.POST(req("POST", { email: "pending@example.com" }), ctx(alice.boardId))).json()).token;

    const del = await create.DELETE(req("DELETE", { token }), ctx(alice.boardId));
    expect(del.status).toBe(200);
    expect((await inviteRow(token)).revokedAt).not.toBeNull();

    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const accept = await import("@/app/api/invites/accept/route");
    expect((await accept.POST(req("POST", { token }))).status).toBe(410);
  });
});

describe("revoking from the pending list, where the token is not available", () => {
  it("an owner can revoke a pending invitation by its id", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    const token = (await (await create.POST(req("POST", { email: "pending@example.com" }), ctx(alice.boardId))).json()).token;
    const [listed] = await (await create.GET(req("GET"), ctx(alice.boardId))).json();

    const del = await create.DELETE(req("DELETE", { id: listed.id }), ctx(alice.boardId));
    expect(del.status).toBe(200);
    expect((await inviteRow(token)).revokedAt).not.toBeNull();
  });

  it("an id from another board cannot be revoked through a board the caller administers", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    const token = (await (await create.POST(req("POST", { email: "pending@example.com" }), ctx(alice.boardId))).json()).token;
    const aliceInviteId = (await inviteRow(token)).id;

    actAs(bob);
    const del = await create.DELETE(req("DELETE", { id: aliceInviteId }), ctx(bob.boardId));
    expect(del.status).toBe(404);
    expect((await inviteRow(token)).revokedAt).toBeNull();
  });
});

describe("invitations cannot be raced or used to escalate", () => {
  it("two simultaneous redemptions of one token credit exactly one", async () => {
    const create = await import("@/app/api/boards/[id]/invites/route");
    const token = (await (await create.POST(req("POST", { email: "newcomer@example.com" }), ctx(alice.boardId))).json()).token;

    const newcomer = await outsider("newcomer");
    actAs(newcomer);
    const { POST } = await import("@/app/api/invites/accept/route");

    // Open the pool's connections first. Otherwise the first request runs to completion on the one
    // warm connection while the rest are still dialling, and the race never happens — this test
    // passed against a check-then-act implementation until the pool was warmed.
    await Promise.all(Array.from({ length: 8 }, () => db.execute(sql`select pg_sleep(0.05)`)));

    // Fired together, several requests read the invite as unaccepted before any stamps it. Only an
    // atomic claim stops more than one being credited. Two requests rarely interleave in-process,
    // so the burst is wide enough that a check-then-act implementation reliably fails this.
    const statuses = (await Promise.all(
      Array.from({ length: 8 }, () => POST(req("POST", { token }))),
    )).map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
  });

  it("a board invite never grants an administrative WORKSPACE role", async () => {
    // Carol administers ONE board but is only a plain member of the workspace.
    const carol = await outsider("carol");
    await db.insert(workspaceMembers).values({
      workspaceId: alice.workspaceId, userId: carol.userId, role: "member",
    });
    await db.insert(boardMembers).values({
      boardId: alice.boardId, userId: carol.userId, role: "admin",
    });
    const [otherBoard] = await db
      .insert(boards)
      .values({ workspaceId: alice.workspaceId, title: "alice private board", createdBy: alice.userId })
      .returning();

    actAs(carol);
    const create = await import("@/app/api/boards/[id]/invites/route");
    const token = (await (await create.POST(req("POST", { email: "crony@example.com", role: "admin" }), ctx(alice.boardId))).json()).token;

    const crony = await outsider("crony");
    actAs(crony);
    const { POST } = await import("@/app/api/invites/accept/route");
    expect((await POST(req("POST", { token }))).status).toBe(200);

    // The board role is honoured where it was granted...
    const [onBoard] = await db.select().from(boardMembers).where(and(
      eq(boardMembers.boardId, alice.boardId), eq(boardMembers.userId, crony.userId),
    ));
    expect(onBoard.role).toBe("admin");

    // ...but it must not become workspace admin, which effectiveRole() inherits onto EVERY board —
    // including ones Carol herself cannot administer.
    const [ws] = await db.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, alice.workspaceId), eq(workspaceMembers.userId, crony.userId),
    ));
    expect(ws.role).toBe("member");
    expect((await create.GET(req("GET"), ctx(otherBoard.id))).status).toBe(403);
  });
});
