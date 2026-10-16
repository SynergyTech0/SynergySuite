import { route } from "@/lib/api";
import { bridgeCookies, safeReturn } from "@/lib/bridge";
import { metabase } from "@/lib/metabase";

export const dynamic = "force-dynamic";

/**
 * The sign-in bridge (see lib/bridge.ts): opens a Metabase session for the person the suite
 * says is signed in, sets it in the browser, and goes back to where they were in the designer.
 */
export const GET = route(async (me, req) => {
  const mb = metabase();
  const session = await mb.sessionFor(me.email, me.name, { fresh: true });
  const to = safeReturn(mb.c, new URL(req.url).searchParams.get("rd"));
  const secure = req.headers.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of bridgeCookies(mb.c, me.email, session, secure)) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
});
