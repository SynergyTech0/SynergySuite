import { NextResponse } from "next/server";
import { db } from "@/db";
import { customFields } from "@/db/schema";
import { publish } from "@/lib/bus";
import { canAdminister, forbidden, notFound, requireBoard } from "@/lib/authz";
import { boardFields, isFieldType } from "@/lib/custom-fields";
import { isUniqueViolation } from "@/lib/releases";

// GET: the board's custom fields (anyone who can see the board).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireBoard(id))) return notFound();
  return NextResponse.json(await boardFields(id));
}

// POST { name, type, options? } — defining fields is an admin action, as in Jira.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoard(id);
  if (!access) return notFound();
  if (!canAdminister(access.role)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!isFieldType(body.type)) return NextResponse.json({ error: `type must be one of: text, number, select, date, user, checkbox` }, { status: 400 });

  let options: string[] | null = null;
  if (body.type === "select") {
    options = Array.isArray(body.options) ? body.options.filter((o: unknown) => typeof o === "string" && o.trim()).map((o: string) => o.trim()) : [];
    if (!options?.length) return NextResponse.json({ error: "a select field needs at least one option" }, { status: 400 });
  }

  const existing = await boardFields(id);
  try {
    const [f] = await db.insert(customFields).values({
      boardId: id, name, type: body.type, options, position: (existing.at(-1)?.position ?? 0) + 1024,
    }).returning();
    publish(id, { type: "changed" });
    return NextResponse.json(f, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: `a field named ${name} already exists` }, { status: 409 });
    throw err;
  }
}
