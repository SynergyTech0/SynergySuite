import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, boards, users, workspaceMembers, workspaces } from "@/db/schema";

/**
 * Backfill membership rows for data that predates tenancy.
 *
 * Before lib/authz.ts existed, nothing read workspace_members or board_members, so rows were only
 * ever written for boards created through POST /api/boards. On the live database that leaves one
 * workspace with a single member and two boards (671 and 110 cards) with no members at all —
 * applying the new authorization without this backfill silently locks real people out of real work.
 *
 * SAFETY: this assumes the single pre-tenancy workspace, where everyone legitimately shared
 * everything. Run against a database that already has several workspaces it would hand every user
 * access to every tenant, so it refuses unless explicitly forced.
 */
export async function backfillMemberships(opts: { force?: boolean } = {}) {
  const allWorkspaces = await db.select().from(workspaces);
  if (allWorkspaces.length === 0) return { workspaceMembers: 0, boardMembers: 0, skipped: "no workspaces" };
  if (allWorkspaces.length > 1 && !opts.force) {
    throw new Error(
      `refusing to backfill: ${allWorkspaces.length} workspaces exist, and this backfill assumes the ` +
        `single pre-tenancy workspace. Re-run with { force: true } only if every user really should ` +
        `belong to every workspace.`,
    );
  }

  const allUsers = await db.select().from(users);
  let wsAdded = 0;
  for (const workspace of allWorkspaces) {
    for (const user of allUsers) {
      const inserted = await db
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: user.id, role: "member" })
        .onConflictDoNothing()
        .returning({ userId: workspaceMembers.userId });
      wsAdded += inserted.length;
    }
  }

  // A board's creator should own it explicitly, so ownership survives any later narrowing of
  // workspace-wide access.
  const allBoards = await db.select().from(boards);
  let boardAdded = 0;
  for (const board of allBoards) {
    if (!board.createdBy) continue;
    const inserted = await db
      .insert(boardMembers)
      .values({ boardId: board.id, userId: board.createdBy, role: "owner" })
      .onConflictDoNothing()
      .returning({ userId: boardMembers.userId });
    boardAdded += inserted.length;
  }

  return { workspaceMembers: wsAdded, boardMembers: boardAdded };
}

/** Report what the backfill would fix, without writing anything. */
export async function membershipGaps() {
  const allBoards = await db.select().from(boards);
  const allUsers = await db.select().from(users);
  const gaps: { board: string; title: string; members: number }[] = [];
  for (const board of allBoards) {
    const members = await db.select().from(boardMembers).where(eq(boardMembers.boardId, board.id));
    gaps.push({ board: board.id, title: board.title, members: members.length });
  }
  const unattached: string[] = [];
  for (const user of allUsers) {
    const rows = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id));
    if (!rows.length) unattached.push(user.name);
  }
  return { boards: gaps, usersWithNoWorkspace: unattached };
}

// `npm run db:backfill` — prints the gaps, applies the backfill, prints what changed.
if (process.argv[1] && process.argv[1].includes("backfill-memberships")) {
  membershipGaps()
    .then((before) => {
      console.log("before:", JSON.stringify(before, null, 2));
      return backfillMemberships();
    })
    .then((result) => {
      console.log("applied:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
}
