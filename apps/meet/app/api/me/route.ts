import { NextResponse } from "next/server";
import { getServerSession, ssoBase } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession();
  return NextResponse.json({ session, ssoAvailable: Boolean(ssoBase()) });
}
