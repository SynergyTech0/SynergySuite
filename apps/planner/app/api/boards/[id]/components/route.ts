import { NextResponse } from "next/server";
import { db } from "@/db";
import { components } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, canSeeBoard, forbidden, isUuid, notFound, requireBoard } from "@/lib/authz";
import { boardComponents, isUniqueViolation } from "@/lib/releases";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  return NextResponse.json(await boardComponents(id));
}

// POST /api/boards/[id]/components { name, description?, leadId? } — admin only. A lead must be able to see the board.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (body.leadId != null && (!isUuid(body.leadId) || !(await canSeeBoard(body.leadId, id)))) return notFound();

  try {
    const [c] = await db.insert(components).values({
      boardId: id, name, description: typeof body.description === "string" ? body.description : null, leadId: body.leadId ?? null,
    }).returning();
    publish(id, { type: "changed" });
    return NextResponse.json(c, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: `a component named ${name} already exists` }, { status: 409 });
    throw err;
  }
}
