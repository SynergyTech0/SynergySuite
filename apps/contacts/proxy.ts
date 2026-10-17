import { NextResponse, type NextRequest } from "next/server";
import { carddav } from "./lib/dav";

// CardDAV (lib/dav.ts) answers here, before the app's routes: DAV clients use methods like
// PROPFIND and REPORT that route handlers don't take. Everything else passes through.
const MAX_BODY = 5 * 1024 * 1024;

export async function proxy(req: NextRequest) {
  const dav = carddav();
  const path = req.nextUrl.pathname;
  if (!dav.matches(req.method, path)) return NextResponse.next();
  let body = "";
  if (req.body) {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > MAX_BODY) return new NextResponse("Too large", { status: 413 });
    body = buf.toString("utf8");
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const r = await dav.handle({ method: req.method, url: path + req.nextUrl.search, headers, body, ip });
    // Next wants redirects absolute (the handler sends /.well-known/carddav to /dav/).
    if (r.headers.location) r.headers.location = new URL(r.headers.location, req.nextUrl.origin).toString();
    return new NextResponse(r.body || null, { status: r.status, headers: r.headers });
  } catch (e) {
    console.error("[contacts] carddav", e);
    return new NextResponse("Something went wrong", { status: 500 });
  }
}

export const config = {
  matcher: ["/", "/dav", "/dav/:path*", "/.well-known/carddav"],
};
