import { currentUser } from "@/lib/api";
import { ringingFor } from "@/lib/calls";
import { subscribe } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * Live events for the signed-in person (server-sent events): ringing, calls changing, new
 * voicemail. Open in every Phone tab, and in the suite header on other apps' pages.
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });
  const enc = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown, event?: string) => {
        try {
          controller.enqueue(enc.encode(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };
      const unsubscribe = await subscribe(me.email, (e) => send(e));
      // Calls already ringing when the tab opened.
      for (const call of await ringingFor(me.email)) send({ type: "ring", call });
      const ping = setInterval(() => send({ t: Date.now() }, "ping"), 25_000);
      close = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };
      req.signal.addEventListener("abort", () => close());
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...cors(req) },
  });
}

/**
 * The suite header on other apps' pages (mail.<domain>, chat.<domain>…) listens here too, so a
 * call rings wherever you are. Only the suite's own subdomains may, and only with your cookie.
 */
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const domain = process.env.SUITE_DOMAIN;
  if (!origin || !domain) return {};
  try {
    const host = new URL(origin).hostname;
    if (host === domain || host.endsWith(`.${domain}`)) return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" };
  } catch {
    /* not a URL */
  }
  return {};
}
