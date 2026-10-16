import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { automations } from "@/db/schema";
import { canAdminister, forbidden, notFound, requireAutomation } from "@/lib/authz";
import { validateRule } from "@/lib/automation";

// PATCH /api/automations/[id] — rename, enable or disable, or change what a rule does.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAutomation(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.isEnabled === "boolean") patch.isEnabled = body.isEnabled;
  // A rule's shape is re-checked on every edit: a rule that passed validation once must not be able
  // to be turned into one that points at another board's list.
  if (body.trigger !== undefined || body.action !== undefined) {
    const [current] = await db.select().from(automations).where(eq(automations.id, id));
    const trigger = body.trigger ?? current.trigger;
    const action = body.action ?? current.action;
    const problem = await validateRule(access.boardId, trigger, action);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    patch.trigger = trigger; patch.action = action;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const [rule] = await db.update(automations).set(patch).where(eq(automations.id, id)).returning();
  return NextResponse.json(rule);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAutomation(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();
  await db.delete(automations).where(eq(automations.id, id));
  return NextResponse.json({ ok: true });
}
