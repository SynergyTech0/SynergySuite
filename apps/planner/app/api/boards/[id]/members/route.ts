import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, users } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, forbidden, notFound, requireBoard, workspacePeerIds, type Role } from "@/lib/authz";

/**
 * Board membership administration — the thing whose absence meant this product could not onboard a
 * second person. board_members existed in the schema, but the only write to it anywhere was
 * app/api/boards/route.ts POST inserting the creator as owner.
 *
 * Two different refusals, deliberately:
 *   404 — the caller cannot see this board at all. Never 403; a 403 confirms it exists.
 *   403 — the caller CAN see the board but lacks the role to administer it. This leaks nothing,
 *         since they already know the board exists.
 *
 * Note what a board_members row does and does not do. visibleBoardIds() is board-members UNION
 * workspace-members, so a workspace peer can already READ the board; the row grants a ROLE on it.
 * Bringing in someone who is not yet in the workspace at all is the invite flow (separate change).
 *
 * Assigning someone to a card (app/api/cards/[id]/members) only needs write access; administering
 * board membership needs owner/admin, or a member could promote themselves to owner.
 */

const ROLES: Role[] = ["owner", "admin", "member", "observer"];

/** Owners on a board, used to refuse orphaning it. */
async function ownerIds(boardId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.role, "owner")));
  return rows.map((r) => r.userId);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();

  const rows = await db
    .select({
      userId: boardMembers.userId,
      role: boardMembers.role,
      name: users.name,
      email: users.email,
      isMind: users.isMind,
    })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, id));

  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const { userId, role = "member" } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  // Only someone who already shares the workspace may be added. Otherwise this route becomes a way
  // to pull a stranger from another tenant onto the board.
  const peers = await workspacePeerIds(access.user.id);
  if (!peers.includes(String(userId))) return notFound();

  await db
    .insert(boardMembers)
    .values({ boardId: id, userId, role })
    .onConflictDoUpdate({ target: [boardMembers.boardId, boardMembers.userId], set: { role } });

  publish(id, { type: "changed" });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const { userId, role } = await req.json();
  if (!userId || !role) return NextResponse.json({ error: "userId and role required" }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  // Demoting the last owner orphans the board exactly as removing them would.
  const owners = await ownerIds(id);
  if (role !== "owner" && owners.length === 1 && owners[0] === userId) {
    return NextResponse.json({ error: "board must keep an owner" }, { status: 409 });
  }

  const [updated] = await db
    .update(boardMembers)
    .set({ role })
    .where(and(eq(boardMembers.boardId, id), eq(boardMembers.userId, userId)))
    .returning();
  if (!updated) return notFound();

  publish(id, { type: "changed" });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const owners = await ownerIds(id);
  if (owners.length === 1 && owners[0] === userId) {
    return NextResponse.json({ error: "board must keep an owner" }, { status: 409 });
  }

  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, id), eq(boardMembers.userId, userId)));

  publish(id, { type: "changed" });
  return NextResponse.json({ ok: true });
}
