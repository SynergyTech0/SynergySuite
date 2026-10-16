import { NextResponse } from "next/server";
import { ssoBase } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sso = ssoBase();
  const home = sso ? `https://meet.${process.env.SUITE_DOMAIN}/` : new URL("/", req.url).toString();
  return NextResponse.redirect(sso ? `${sso}/oauth2/sign_out?rd=${encodeURIComponent(home)}` : home);
}
