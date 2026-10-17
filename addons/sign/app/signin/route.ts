import { NextResponse } from "next/server";
import { signInUrl, ssoBase } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sends someone to the suite sign-in, then back to the Sign page they wanted. */
export async function GET(req: Request) {
  const rd = new URL(req.url).searchParams.get("rd") || "/dashboard";
  if (!ssoBase()) {
    // No gateway (local run without SUITE_DOMAIN): redirecting back would loop.
    return new NextResponse(
      "Sign uses the suite sign-in. Open it through the suite gateway, or set DEV_USER_EMAIL for local development.",
      { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return NextResponse.redirect(signInUrl(rd));
}
