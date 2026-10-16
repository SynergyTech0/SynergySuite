import { identify, optionsFromEnv } from "@synergy/identity";
import { fail, safeNext } from "@/lib/api";
import { personSession } from "@/lib/engine";

export const dynamic = "force-dynamic";

/**
 * Signs the person in to the flow designer. The gateway serves this at
 * flow-studio.<domain>/synergy/sso, on the designer's own origin, so the page can hand the
 * designer its session the way the designer's own sign-in page would (in localStorage) and
 * then open the requested page. The token never appears in a URL.
 */
export async function GET(req: Request): Promise<Response> {
  const me = identify(req.headers, optionsFromEnv());
  if (!me) return new Response("Sign in to the suite first.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    const s = await personSession(me);
    const next = safeNext(new URL(req.url).searchParams.get("next"));
    const data = JSON.stringify({ token: s.token, projectId: s.projectId, next }).replace(/</g, "\\u003c");
    const html = `<!doctype html><meta charset="utf-8"><title>Opening Synergy Flow…</title><meta name="referrer" content="no-referrer">
<p style="font:14px system-ui,sans-serif;color:#555;padding:24px">Opening the flow designer…</p>
<script>(function(){var d=${data};try{localStorage.setItem("token",d.token);localStorage.setItem("projectId",d.projectId);}catch(e){}location.replace(d.next);})();</script>`;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
