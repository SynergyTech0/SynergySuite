import { NextResponse } from "next/server";
import { currentUser } from "@/lib/api";
import { accessContact, canUseVault } from "@/lib/access";

/** Who is signed in and whether they may open the vault; answers people without access too, so the page can say so. */
export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ email: me.email, name: me.name, allowed: canUseVault(me.email), contact: accessContact() });
}
