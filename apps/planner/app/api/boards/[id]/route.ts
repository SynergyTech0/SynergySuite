import { NextResponse } from "next/server";
import { db } from "@/db";
import { boards } from "@/db/schema";
import { eq } from "drizzle-orm";
import { boardSnapshot } from "@/lib/board-snapshot";
import { publish } from "@/lib/bus";
import { canAdminister, canWrite, forbidden, notFound, requireBoard } from "@/lib/authz";
import { normalisePrefix, prefixTaken } from "@/lib/key-prefix";
import { isHexColor } from "@/lib/validate";

// Full board snapshot (board + lists + sprints + cards with face labels) — clients refetch this on
// a live event, and the backlog/sprint view reads sprints from the same snapshot. Answers 404 for a
// board the caller is not a member of: the snapshot is the single richest cross-tenant leak here.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  return NextResponse.json(await boardSnapshot(id));
}

/**
 * PATCH /api/boards/[id] — board settings.
 *
 * Title and description are everyday edits any member makes (as in Trello). Closing/reopening and
 * the issue-key prefix are administrative: closing hides the board from everyone, and the prefix
 * decides every future key. keyPrefix is deliberately NOT rewritten across existing cards: issue
 * keys are quoted in commits, chats and the mind's refs, so a new prefix applies to new keys only.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canWrite(access.role)) return forbidden();

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if ("background" in body) {
    if (body.background !== null && !isHexColor(body.background)) {
      return NextResponse.json({ error: "background must be #rrggbb" }, { status: 400 });
    }
    patch.background = body.background;
  }

  if ("keyPrefix" in body || "isClosed" in body) {
    if (!canAdminister(access.role)) return forbidden();
  }
  if ("keyPrefix" in body) {
    const p = normalisePrefix(body.keyPrefix);
    if (!p) return NextResponse.json({ error: "keyPrefix must be 2-10 letters or digits, starting with a letter" }, { status: 400 });
    const [board] = await db.select({ workspaceId: boards.workspaceId }).from(boards).where(eq(boards.id, id));
    if (board && await prefixTaken(board.workspaceId, p, id)) {
      return NextResponse.json({ error: `${p} is already used by another board` }, { status: 409 });
    }
    patch.keyPrefix = p;
  }
  if ("isClosed" in body) patch.isClosed = !!body.isClosed;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const [board] = await db.update(boards).set(patch).where(eq(boards.id, id)).returning();
  if (!board) return notFound();
  publish(id, { type: "changed" });
  return NextResponse.json(board);
}

/**
 * DELETE /api/boards/[id] — permanent, and cascades to every list, card, comment and attachment. As in
 * Trello it takes two deliberate steps: the board must be closed first, and only an admin can do it.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const [board] = await db.select().from(boards).where(eq(boards.id, id));
  if (!board) return notFound();
  if (!board.isClosed) return NextResponse.json({ error: "close the board before deleting it" }, { status: 409 });

  await db.delete(boards).where(eq(boards.id, id));
  publish(id, { type: "changed" });
  return NextResponse.json({ ok: true });
}
