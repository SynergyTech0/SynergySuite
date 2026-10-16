import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers, invites, workspaceMembers } from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound } from "@/lib/authz";

/**
 * Redeem an invitation. This is the route that makes the product multi-player: it puts the
 * accepting user into the WORKSPACE, which is what visibleBoardIds() reads (board-members UNION
 * workspace-members), and optionally gives them a role on the specific board.
 *
 * Deliberate policy — an invite binds to whoever redeems it, not to the address it was sent to.
 * The email is an addressing hint, not an identity assertion: the invitee usually has no user row
 * until SynergyAuth provisions them on first sign-in, and SSO may well supply a different address
 * than the one that was typed. Refusing on mismatch would break the ordinary case while adding
 * little, since anyone holding the token already has the secret. What protects this instead is that
 * the token is single-use, expiring and revocable, and acceptedBy records who ACTUALLY redeemed it
 * — so a misdirected invite is auditable rather than silent.
 *
 * Status codes: 404 unknown token (reveals nothing), 409 already redeemed, 410 expired or revoked.
 */
export async function POST(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const [invite] = await db.select().from(invites).where(eq(invites.token, String(token)));
  if (!invite) return notFound();

  if (invite.acceptedAt) {
    return NextResponse.json({ error: "already accepted" }, { status: 409 });
  }
  if (invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "invitation is no longer valid" }, { status: 410 });
  }

  // Claim FIRST, atomically, and grant nothing unless the claim wins. The checks above only choose a
  // helpful status code; this conditional UPDATE is what enforces single use, because a burst of
  // requests can all read the invite as unaccepted before any of them writes. Postgres serialises
  // the UPDATEs on the row, and every loser re-evaluates the WHERE, finds acceptedAt set, and
  // matches nothing. The transaction means a failed grant releases the claim rather than burning it.
  const now = new Date();
  const outcome = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invites)
      .set({ acceptedAt: now, acceptedBy: user.id })
      .where(and(
        eq(invites.id, invite.id),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
      ))
      .returning({ id: invites.id });
    if (!claimed) return "lost" as const;

    // Workspace membership is what grants visibility; the board role is the optional extra. The
    // workspace role is capped at member: effectiveRole() inherits a workspace owner/admin onto
    // EVERY board in it, so passing an admin role through would let a single board's admin mint
    // administrators of boards they cannot administer themselves. Neither insert overwrites an
    // existing row — re-joining must never silently demote someone.
    await tx
      .insert(workspaceMembers)
      .values({
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role === "observer" ? "observer" : "member",
      })
      .onConflictDoNothing();

    if (invite.boardId) {
      await tx
        .insert(boardMembers)
        .values({ boardId: invite.boardId, userId: user.id, role: invite.role })
        .onConflictDoNothing();
    }
    return "won" as const;
  });

  if (outcome === "lost") {
    // Lost to a concurrent redemption, or revoked/expired in the window since the read above.
    const [current] = await db
      .select({ acceptedAt: invites.acceptedAt })
      .from(invites)
      .where(eq(invites.id, invite.id));
    return current?.acceptedAt
      ? NextResponse.json({ error: "already accepted" }, { status: 409 })
      : NextResponse.json({ error: "invitation is no longer valid" }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    workspaceId: invite.workspaceId,
    boardId: invite.boardId,
    role: invite.role,
  });
}
