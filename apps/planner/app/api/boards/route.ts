import { NextResponse } from "next/server";
import { db } from "@/db";
import { boards, boardStars, lists, workspaces, workspaceMembers, boardMembers } from "@/db/schema";
import { normalisePrefix, prefixTaken, uniquePrefixFor } from "@/lib/key-prefix";
import { inferCategory } from "@/lib/workflow";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound, visibleBoardIds } from "@/lib/authz";
import { eq, and, asc, inArray, ne, sql } from "drizzle-orm";

/**
 * The caller's OWN workspace. It used to be `workspaces.findFirst()` — the first workspace in the
 * table — so every user was auto-joined as owner of whichever tenant happened to exist first. That
 * is the root of the cross-tenant hole, not merely a missing check.
 *
 * Once invitations exist a user can belong to several workspaces, and an unordered lookup put their
 * new boards in whichever membership row Postgres returned first — often a workspace they had merely
 * been invited into, where that team would see it. So: the workspace they own, then one they
 * administer, then one they are a member of (how a team member creates a team board, as in Trello).
 * Never one where they are only an observer; with nothing else, they get a workspace of their own.
 */
async function ownWorkspace(userId: string, name: string) {
  const [mine] = await db
    .select({ ws: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), ne(workspaceMembers.role, "observer")))
    .orderBy(
      sql`case ${workspaceMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
      asc(workspaces.createdAt),
    )
    .limit(1);
  if (mine) return mine.ws;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace"}-${userId.slice(0, 8)}`;
  const [ws] = await db.insert(workspaces).values({ name, slug }).returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" }).onConflictDoNothing();
  return ws;
}

// GET /api/boards — the caller's open boards (or closed ones with ?closed=1), each flagged with
// whether the caller has starred it.
export async function GET(req?: Request) {
  // No trusted identity is refused the same way a foreign board is — 404, not a 500.
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const closed = req ? new URL(req.url).searchParams.get("closed") === "1" : false;
  const ids = await visibleBoardIds(user.id);
  if (!ids.length) return NextResponse.json([]);
  const rows = await db
    .select({ board: boards, starredAt: boardStars.createdAt })
    .from(boards)
    .leftJoin(boardStars, and(eq(boardStars.boardId, boards.id), eq(boardStars.userId, user.id)))
    .where(and(eq(boards.isClosed, closed), inArray(boards.id, ids)))
    .orderBy(asc(boards.title));
  return NextResponse.json(rows.map((r) => ({ ...r.board, starred: r.starredAt !== null })));
}

export async function POST(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const ws = await ownWorkspace(user.id, `${user.name}'s workspace`);

  let keyPrefix: string;
  if (body.keyPrefix !== undefined && body.keyPrefix !== null && body.keyPrefix !== "") {
    const p = normalisePrefix(body.keyPrefix);
    if (!p) return NextResponse.json({ error: "keyPrefix must be 2-10 letters or digits, starting with a letter" }, { status: 400 });
    if (await prefixTaken(ws.id, p)) return NextResponse.json({ error: `${p} is already used by another board` }, { status: 409 });
    keyPrefix = p;
  } else {
    keyPrefix = await uniquePrefixFor(ws.id, title);
  }

  const [board] = await db.insert(boards)
    .values({ workspaceId: ws.id, title, keyPrefix, createdBy: user.id }).returning();
  await db.insert(boardMembers)
    .values({ boardId: board.id, userId: user.id, role: "owner" }).onConflictDoNothing();
  await db.insert(lists).values(
    ["To Do", "Doing", "Done"].map((t, i) => ({ boardId: board.id, title: t, position: (i + 1) * 1024, statusCategory: inferCategory(t) })));
  return NextResponse.json(board, { status: 201 });
}
