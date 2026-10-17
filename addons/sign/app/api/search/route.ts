import { NextResponse } from "next/server";
import { SearchInputError } from "@synergy/search";
import { getServerSession } from "@/lib/auth";
import { searchFor } from "@/lib/search";

export const dynamic = "force-dynamic";

/** Suite search, on behalf of the signed-in person (gateway headers, like every other route). */
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body" }, { status: 400 });
  }
  try {
    return NextResponse.json(await searchFor(session.user, body));
  } catch (err) {
    if (err instanceof SearchInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[sign] search", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
