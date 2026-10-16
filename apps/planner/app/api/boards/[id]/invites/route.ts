import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { boards, invites } from "@/db/schema";
import { canAdminister, forbidden, notFound, requireBoard, type Role } from "@/lib/authz";

/**
 * Invitations — the half of membership that actually fixes onboarding.
 *
 * /api/boards/[id]/members only grants a ROLE to someone who already shares the workspace, and
 * ownWorkspace() puts every new user in their own workspace, so there was never anyone to promote.
 * An invite is addressed to an EMAIL because the invitee usually has no user row yet: users are
 * provisioned from SynergyAuth on first sign-in.
 *
 * The token is a bearer credential that travels in a link, so:
 *   - it is generated with crypto.randomUUID(), never Math.random();
 *   - it is returned exactly once, from POST, and NEVER from GET;
 *   - revoking sets revokedAt rather than deleting, so the audit trail survives.
 *
 * Same two refusals as the members route: 404 when the caller cannot see the board at all, 403 when
 * they can see it but may not administer it.
 */

const INVITE_TTL_DAYS = 14;

const ROLES: Role[] = ["owner", "admin", "member", "observer"];

async function administrable(id: string) {
  const access = await requireBoard(id);
  if (!access) return { error: notFound() };
  if (!canAdminister(access.role)) return { error: forbidden() };
  const [board] = await db.select().from(boards).where(eq(boards.id, id));
  return { access, board };
}

// Pending invitations only. The token is deliberately absent from the projection — anyone who can
// list invitations could otherwise redeem one addressed to somebody else.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await administrable(id);
  if (gate.error) return gate.error;

  const rows = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      boardId: invites.boardId,
      invitedBy: invites.invitedBy,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .where(and(
      eq(invites.boardId, id),
      isNull(invites.acceptedAt),
      isNull(invites.revokedAt),
    ));

  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await administrable(id);
  if (gate.error) return gate.error;

  const { email, role = "member" } = await req.json();
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  if (!ROLES.includes(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);

  const [row] = await db
    .insert(invites)
    .values({
      workspaceId: gate.board.workspaceId,
      boardId: id,
      email: email.trim().toLowerCase(),
      role,
      token,
      invitedBy: gate.access.user.id,
      expiresAt,
    })
    .returning();

  // The only response that ever carries the token.
  return NextResponse.json(
    { id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, token },
    { status: 201 },
  );
}

// Revoke by id (the pending list never carries tokens) or by token (straight after creating one).
// Either way the match is also scoped to this board, so an id from another tenant's board matches
// nothing here. Sets revokedAt rather than deleting, so a redeemed-or-revoked link leaves a record
// of what was offered to whom.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await administrable(id);
  if (gate.error) return gate.error;

  const { id: inviteId, token } = await req.json();
  if (!inviteId && !token) return NextResponse.json({ error: "id or token required" }, { status: 400 });
  // invites.id is a uuid column; a malformed id would be a Postgres cast error (500), not a miss.
  if (inviteId && !/^[0-9a-f-]{36}$/i.test(String(inviteId))) return notFound();

  const [revoked] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(
      inviteId ? eq(invites.id, String(inviteId)) : eq(invites.token, String(token)),
      eq(invites.boardId, id),
      isNull(invites.acceptedAt),
    ))
    .returning({ id: invites.id });
  if (!revoked) return notFound();

  return NextResponse.json({ ok: true });
}
