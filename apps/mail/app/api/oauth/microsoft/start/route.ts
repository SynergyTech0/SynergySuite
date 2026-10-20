import { NextResponse } from "next/server";
import { currentUser } from "@/lib/api";
import { demoMode } from "@/lib/demo";
import { PENDING_COOKIE, microsoftConfig, publicUrl, startSignIn } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/** Add account → Sign in with Microsoft: off to Microsoft, back at ../callback. */
export async function GET(req: Request): Promise<Response> {
  const who = await currentUser();
  if (!who) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const back = (error: string) => NextResponse.redirect(`${publicUrl()}/?connectError=${encodeURIComponent(error)}`);
  if (demoMode()) return back("This is a demo: outside accounts can't be added");
  const config = microsoftConfig();
  if (!config) return back("Sign in with Microsoft isn't set up on this server yet. Ask your administrator to set MAIL_MICROSOFT_CLIENT_ID and MAIL_MICROSOFT_CLIENT_SECRET.");
  const hint = new URL(req.url).searchParams.get("address")?.trim().slice(0, 254) || undefined;
  const { url, cookie } = startSignIn(config, who.email, hint);
  const res = NextResponse.redirect(url);
  res.cookies.set(PENDING_COOKIE, cookie, {
    httpOnly: true, sameSite: "lax", secure: publicUrl().startsWith("https:"), path: "/api/oauth/microsoft", maxAge: 600,
  });
  return res;
}
