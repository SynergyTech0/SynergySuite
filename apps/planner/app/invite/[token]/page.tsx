import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boards, invites } from "@/db/schema";
import { AcceptInvite } from "./AcceptInvite";

export const dynamic = "force-dynamic";

/**
 * Landing page for an invite link. It only READS: link scanners and chat unfurlers fetch URLs, so a
 * page that redeemed on render would hand the invite to whichever account happened to load it first.
 * Redemption is the explicit POST behind the Accept button.
 *
 * Any token that cannot be redeemed renders the same message with no board name, so a guessed,
 * revoked or expired token tells the holder nothing about the board it pointed at.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite] = await db
    .select({
      boardId: invites.boardId,
      role: invites.role,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      expiresAt: invites.expiresAt,
      boardTitle: boards.title,
    })
    .from(invites)
    .leftJoin(boards, eq(boards.id, invites.boardId))
    .where(eq(invites.token, token));

  const usable = invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt.getTime() > Date.now();

  return (
    <div className="wrap">
      <div className="invite">
        {usable ? (
          <>
            <div className="h1">You&apos;ve been invited to {invite.boardTitle ?? "a workspace"}</div>
            <p className="muted">You&apos;ll join as {invite.role === "observer" ? "an observer" : `a ${invite.role}`}.</p>
            <AcceptInvite token={token} boardId={invite.boardId} />
          </>
        ) : (
          <>
            <div className="h1">This invitation can&apos;t be used</div>
            <p className="muted">It may have expired, been revoked, or already been accepted. Ask whoever sent it for a new link.</p>
            <a href="/" className="btn">Go to your boards</a>
          </>
        )}
      </div>
    </div>
  );
}
