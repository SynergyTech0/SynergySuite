import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, invites, users, workspaceMembers } from "@/db/schema";
import { closeDb, resetDb } from "../helpers/db";
import { seedTenant, type Tenant } from "../helpers/seed";

/**
 * The acceptance page behind an invite link. Two properties matter more than the happy path:
 *
 *  - RENDERING never redeems. Mail scanners and chat unfurlers fetch links, and the inviter's own
 *    click-to-check would otherwise burn the invite into the wrong account. Only the explicit POST
 *    from the Accept button grants anything.
 *  - A token that is unknown, revoked or expired reveals nothing about the board it named.
 */

const identity = { sub: "", email: "" };

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-user": identity.sub,
      "x-forwarded-email": identity.email,
    }),
}));

function treeContains(node: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.includes(needle);
  if (typeof node === "number") return String(node).includes(needle);
  if (typeof node !== "object") return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((n) => treeContains(n, needle, seen));
  return Object.entries(node as Record<string, unknown>)
    .filter(([k]) => k !== "_owner" && k !== "_store")
    .some(([, v]) => treeContains(v, needle, seen));
}

const page = (token: string) => ({ params: Promise.resolve({ token }) });

let alice: Tenant;
let newcomerId: string;

async function invite(overrides: Partial<typeof invites.$inferInsert> = {}) {
  const token = crypto.randomUUID();
  await db.insert(invites).values({
    workspaceId: alice.workspaceId,
    boardId: alice.boardId,
    email: "newcomer@example.com",
    token,
    invitedBy: alice.userId,
    expiresAt: new Date(Date.now() + 86400000),
    ...overrides,
  });
  return token;
}

beforeEach(async () => {
  await resetDb();
  alice = await seedTenant("alice");
  const [u] = await db
    .insert(users)
    .values({ authSub: "sub-newcomer", email: "newcomer@example.com", name: "Newcomer" })
    .returning();
  newcomerId = u.id;
  identity.sub = "sub-newcomer";
  identity.email = "newcomer@example.com";
});

afterAll(async () => {
  await closeDb();
});

describe("the invite acceptance page", () => {
  it("names the board for a valid invitation", async () => {
    const { default: InvitePage } = await import("@/app/invite/[token]/page");
    const rendered = await InvitePage(page(await invite()));
    expect(treeContains(rendered, "alice board")).toBe(true);
  });

  it("does not redeem the invitation merely by being rendered", async () => {
    const token = await invite();
    const { default: InvitePage } = await import("@/app/invite/[token]/page");
    await InvitePage(page(token));

    const [row] = await db.select().from(invites).where(eq(invites.token, token));
    expect(row.acceptedAt).toBeNull();
    expect(await db.select().from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, alice.workspaceId), eq(workspaceMembers.userId, newcomerId),
    ))).toHaveLength(0);
    expect(await db.select().from(boardMembers).where(eq(boardMembers.userId, newcomerId))).toHaveLength(0);
  });

  it.each([
    ["unknown", async () => "not-a-real-token"],
    ["revoked", async () => invite({ revokedAt: new Date() })],
    ["expired", async () => invite({ expiresAt: new Date(Date.now() - 1000) })],
  ])("reveals nothing about the board for a %s token", async (_label, make) => {
    const { default: InvitePage } = await import("@/app/invite/[token]/page");
    const rendered = await InvitePage(page(await make()));
    expect(treeContains(rendered, "alice board")).toBe(false);
  });
});
