import { NextResponse, type NextRequest } from "next/server";

/**
 * Who may show Search inside a frame. The Copilot panel (/copilot) opens in the suite header of
 * every app, so the suite's own sites may frame it; everything else only Search itself, so no
 * other site can frame it to trick a click on Confirm.
 */
export function proxy(request: NextRequest) {
  const res = NextResponse.next();
  const domain = process.env.SUITE_DOMAIN;
  const suite = domain ? `https://*.${domain} https://${domain}` : "http://localhost:*";
  const panel = request.nextUrl.pathname === "/copilot" || request.nextUrl.pathname.startsWith("/copilot/");
  res.headers.set("Content-Security-Policy", `frame-ancestors 'self'${panel ? ` ${suite}` : ""}`);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
