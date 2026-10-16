import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { getCurrentUserOrNull } from "@/lib/session";
import { notFound } from "@/lib/authz";
import { JqlError, parseJql } from "@/lib/jql";
import { isUniqueViolation } from "@/lib/releases";

// Saved searches, personal to the caller. The query is validated on save so a filter cannot be
// stored broken and then fail every time it is opened.
export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  return NextResponse.json(
    await db.select().from(savedFilters).where(eq(savedFilters.userId, user.id)).orderBy(asc(savedFilters.name)),
  );
}

export async function POST(req: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) return notFound();
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    parseJql(query);
  } catch (err) {
    if (err instanceof JqlError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  try {
    const [f] = await db.insert(savedFilters).values({ userId: user.id, name, query }).returning();
    return NextResponse.json(f, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: `you already have a filter named ${name}` }, { status: 409 });
    throw err;
  }
}
