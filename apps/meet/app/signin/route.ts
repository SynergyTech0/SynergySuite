import { NextResponse } from "next/server";
import { ssoBase } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Send a guest to the suite sign-in, then back to the page they came from. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sso = ssoBase();
  // Behind the gateway the app sees plain http, so name the public origin explicitly.
  const origin = sso ? `https://meet.${process.env.SUITE_DOMAIN}` : url.origin;
  const back = new URL(safePath(url.searchParams.get("rd")), origin).toString();
  return NextResponse.redirect(sso ? `${sso}/oauth2/start?rd=${encodeURIComponent(back)}` : back);
}

function safePath(p: string | null): string {
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/";
}
