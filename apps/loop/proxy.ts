import { NextResponse, type NextRequest } from "next/server";

/**
 * Who may show Loop inside a frame. Components (/embed) may sit in any suite app, such as a Chat
 * message; everything else only in Loop itself, so no other site can frame it to trick a click.
 */
export function proxy(request: NextRequest) {
  const res = NextResponse.next();
  const domain = process.env.SUITE_DOMAIN;
  const suite = domain ? `https://*.${domain}` : "http://localhost:*";
  const embed = request.nextUrl.pathname.startsWith("/embed/");
  res.headers.set("Content-Security-Policy", `frame-ancestors 'self'${embed ? ` ${suite}` : ""}`);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
