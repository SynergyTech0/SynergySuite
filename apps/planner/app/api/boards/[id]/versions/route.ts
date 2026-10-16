import { NextResponse } from "next/server";
import { db } from "@/db";
import { versions } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, forbidden, notFound, requireBoard } from "@/lib/authz";
import { isUniqueViolation, versionsWithProgress } from "@/lib/releases";
import { parseDate } from "@/lib/validate";

// GET /api/boards/[id]/versions — versions with progress. Anyone who can see the board.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  return NextResponse.json(await versionsWithProgress(id));
}

// POST /api/boards/[id]/versions { name, description?, startDate?, releaseDate? } — admin only, as in Jira.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const startDate = parseDate(body.startDate ?? null);
  const releaseDate = parseDate(body.releaseDate ?? null);
  if (startDate === undefined || releaseDate === undefined) return NextResponse.json({ error: "invalid date" }, { status: 400 });

  try {
    const [v] = await db.insert(versions).values({
      boardId: id, name, description: typeof body.description === "string" ? body.description : null, startDate, releaseDate,
    }).returning();
    publish(id, { type: "changed" });
    return NextResponse.json(v, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: `a version named ${name} already exists` }, { status: 409 });
    throw err;
  }
}
