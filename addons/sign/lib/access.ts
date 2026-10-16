import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession, type Session } from "@/lib/auth";

/**
 * Who may touch what.
 *
 *   - A document belongs to its sender. The sender, and Sign admins, may read and change it.
 *   - A signer holds a token from their email link. It opens that one document, and lets them fill
 *     only the fields assigned to them, until they have signed, declined or the link expires.
 *   - A template belongs to its creator; a public template can also be read and copied by anyone
 *     signed in.
 */

export type Denied = { denied: Response };

const unauthorized = () => NextResponse.json({ error: "Sign in required" }, { status: 401 });
// Not 403: don't confirm to a stranger that the id exists.
const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });

export async function requireSession(): Promise<Session | Denied> {
  const session = await getServerSession();
  return session ? session : { denied: unauthorized() };
}

export function isDenied<T>(x: T | Denied): x is Denied {
  return typeof x === "object" && x !== null && "denied" in x;
}

/** The document, when the signed-in person sent it (or is a Sign admin). */
export async function documentForOwner(id: string): Promise<{ session: Session; document: { id: string; senderId: string; title: string } } | Denied> {
  const session = await requireSession();
  if (isDenied(session)) return session;
  const document = await prisma.document.findUnique({ where: { id }, select: { id: true, senderId: true, title: true } });
  if (!document || (document.senderId !== session.user.id && session.user.role !== "ADMIN")) return { denied: notFound("Document") };
  return { session, document };
}

/** The template, for its creator or an admin; with `read`, also anyone signed in when it is public. */
export async function templateFor(id: string, opts: { read?: boolean } = {}): Promise<{ session: Session; template: { id: string; creatorId: string; isPublic: boolean } } | Denied> {
  const session = await requireSession();
  if (isDenied(session)) return session;
  const template = await prisma.template.findUnique({ where: { id }, select: { id: true, creatorId: true, isPublic: true } });
  const ok = template && (template.creatorId === session.user.id || session.user.role === "ADMIN" || (opts.read && template.isPublic));
  if (!template || !ok) return { denied: notFound("Template") };
  return { session, template };
}

/** The signer a link token belongs to, while it can still be used to sign. */
export async function signerForToken(token: string | null | undefined, opts: { forWriting?: boolean } = {}) {
  if (!token || typeof token !== "string") return { denied: NextResponse.json({ error: "Missing token" }, { status: 400 }) } as Denied;
  const signer = await prisma.documentSigner.findUnique({
    where: { token },
    include: { document: { select: { id: true, signingOrder: true, status: true } } },
  });
  if (!signer) return { denied: NextResponse.json({ error: "Invalid token" }, { status: 404 }) } as Denied;
  if (signer.tokenExpiresAt && signer.tokenExpiresAt < new Date()) {
    return { denied: NextResponse.json({ error: "This signing link has expired" }, { status: 403 }) } as Denied;
  }
  if (opts.forWriting) {
    if (signer.status === "COMPLETED" || signer.status === "DECLINED") {
      return { denied: NextResponse.json({ error: "This signer has already finished" }, { status: 409 }) } as Denied;
    }
    if (signer.document.status !== "SENT") {
      return { denied: NextResponse.json({ error: "This document is closed" }, { status: 409 }) } as Denied;
    }
    if (signer.document.signingOrder === "SEQUENTIAL") {
      const earlier = await prisma.documentSigner.count({
        where: { documentId: signer.documentId, order: { lt: signer.order }, status: { not: "COMPLETED" } },
      });
      if (earlier > 0) return { denied: NextResponse.json({ error: "It isn't your turn to sign yet" }, { status: 403 }) } as Denied;
    }
  }
  return signer;
}
