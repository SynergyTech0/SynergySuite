import { NextResponse } from "next/server";
import { signOutUrl, publicBase } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Signs out of the suite. Sign keeps no session of its own. */
export async function GET() {
  const to = signOutUrl();
  return NextResponse.redirect(to.startsWith("/") ? `${publicBase()}${to}` : to);
}
