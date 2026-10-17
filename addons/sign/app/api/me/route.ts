import { NextResponse } from "next/server";
import { getServerSession, signOutUrl } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The signed-in suite person as Sign knows them; 401 for anyone else. */
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ user: session.user, signOutUrl: signOutUrl(), billing: process.env.SIGN_BILLING === "1" });
}
