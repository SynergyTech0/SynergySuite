import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { automations } from "@/db/schema";
import { canAdminister, forbidden, notFound, requireBoard } from "@/lib/authz";
import { validateRule } from "@/lib/automation";

/**
 * GET/POST /api/boards/[id]/automations — the board's rules.
 *
 * Reading is for anyone who can see the board (a rule explains why cards move on their own, and
 * hiding that makes the board feel haunted); writing is for admins, because a rule acts on everyone
 * else's cards.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  return NextResponse.json(
    await db.select().from(automations).where(eq(automations.boardId, id)).orderBy(asc(automations.createdAt)));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const problem = await validateRule(id, body?.trigger, body?.action);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const [rule] = await db.insert(automations).values({
    boardId: id, name, trigger: body.trigger, action: body.action, createdBy: access.user.id,
  }).returning();
  return NextResponse.json(rule, { status: 201 });
}
