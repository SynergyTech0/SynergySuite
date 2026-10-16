import { NextResponse } from "next/server";
import { identity } from "@/lib/identity";
import { labelList } from "@/lib/policy";

export const dynamic = "force-dynamic";

/** The organization's sensitivity labels, least sensitive first, and the one new documents get. */
export async function GET() {
  const me = await identity();
  if (!me.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json(await labelList());
}
