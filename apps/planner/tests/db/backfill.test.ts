import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { boards, cards, lists, users, workspaceMembers, workspaces } from "@/db/schema";
import { backfillMemberships, membershipGaps } from "@/db/backfill-memberships";
import { canSeeBoard } from "@/lib/authz";
import { closeDb, resetDb } from "../helpers/db";

/**
 * The live database shape this exists for: one workspace, one workspace member, four boards, two of
 * them (671 and 110 cards) with no members at all, and three users attached to nothing. Applying
 * authorization to that without a backfill locks real people out of real work.
 */
async function seedPreTenancyShape() {
  const [workspace] = await db.insert(workspaces).values({ name: "Synergy", slug: "synergy" }).returning();

  const [shane] = await db.insert(users).values({ authSub: "shane", name: "shane", email: "shane@x" }).returning();
  const [doug] = await db.insert(users).values({ authSub: "doug", name: "Doug", email: "doug@x" }).returning();
  const [mind] = await db.insert(users).values({ name: "Synergy Mind", isMind: true, email: "mind@x" }).returning();

  // only shane was ever attached to the workspace
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: shane.id, role: "owner" });

  // a board the mind created through the token path: no members, lots of cards
  const [mindOps] = await db.insert(boards).values({ workspaceId: workspace.id, title: "Mind Ops" }).returning();
  const [list] = await db.insert(lists).values({ boardId: mindOps.id, title: "Proposed", position: 1024 }).returning();
  await db.insert(cards).values({ listId: list.id, boardId: mindOps.id, title: "a mind card", position: 1024 });

  // a board created through the API: has an owner
  const [owned] = await db
    .insert(boards)
    .values({ workspaceId: workspace.id, title: "Shane work", createdBy: shane.id })
    .returning();

  return { workspace, shane, doug, mind, mindOps, owned };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("membership backfill", () => {
  it("reports the gaps before changing anything", async () => {
    const { doug, mind } = await seedPreTenancyShape();
    const before = await membershipGaps();

    expect(before.usersWithNoWorkspace.sort()).toEqual([doug.name, mind.name].sort());
    expect(before.boards.find((b) => b.title === "Mind Ops")!.members).toBe(0);
  });

  it("gives every existing user access to the boards they used to share", async () => {
    const { doug, mindOps, owned } = await seedPreTenancyShape();

    expect(await canSeeBoard(doug.id, mindOps.id)).toBe(false); // locked out before

    const result = await backfillMemberships();
    expect(result.workspaceMembers).toBeGreaterThan(0);

    expect(await canSeeBoard(doug.id, mindOps.id)).toBe(true);
    expect(await canSeeBoard(doug.id, owned.id)).toBe(true);
  });

  it("records the creator as board owner where one is known", async () => {
    const { shane, owned } = await seedPreTenancyShape();
    const result = await backfillMemberships();

    expect(result.boardMembers).toBe(1); // only the board that has createdBy
    expect(await canSeeBoard(shane.id, owned.id)).toBe(true);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await seedPreTenancyShape();
    await backfillMemberships();
    const second = await backfillMemberships();

    expect(second).toEqual({ workspaceMembers: 0, boardMembers: 0 });
  });

  it("refuses to run once there is more than one tenant, unless forced", async () => {
    await seedPreTenancyShape();
    await db.insert(workspaces).values({ name: "Another tenant", slug: "other" });

    await expect(backfillMemberships()).rejects.toThrow(/refusing to backfill/);

    // the escape hatch still exists, but only when asked for explicitly
    await expect(backfillMemberships({ force: true })).resolves.toBeTruthy();
  });

  it("does nothing on an empty database", async () => {
    const result = await backfillMemberships();
    expect(result.skipped).toBe("no workspaces");
  });
});
