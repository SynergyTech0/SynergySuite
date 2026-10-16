import { NextResponse } from "next/server";
import { bridgeMatches } from "@/lib/bridge";
import { config } from "@/lib/config";
import { currentUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Asked by the gateway (Caddy forward_auth) before every request to the report designer: does
 * the browser's Metabase session belong to the person who is signed in to the suite? 204 lets
 * the request through; 401 sends the browser to /api/studio/login to be signed in again.
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (me && bridgeMatches(config(), me.email, req.headers.get("cookie"))) return new NextResponse(null, { status: 204 });
  return new NextResponse(null, { status: 401 });
}
