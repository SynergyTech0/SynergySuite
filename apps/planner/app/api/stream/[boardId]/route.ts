import { bus } from "@/lib/bus";
import { canSeeBoard } from "@/lib/authz";
import { getCurrentUserOrNull } from "@/lib/session";

export const dynamic = "force-dynamic";

// Server-Sent Events: one long-lived stream per board. Emits {type:"changed"} whenever anything
// on the board mutates (human or mind), so every open client refetches and stays live.
export async function GET(req: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  // A stream is a live feed of a board's activity, so a subscription needs membership. An
  // untrusted request gets the same 404 as a foreign board — never a 500, and never a stream.
  const user = await getCurrentUserOrNull();
  if (!user || !(await canSeeBoard(user.id, boardId))) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const enc = new TextEncoder();
  let onEvt: (e: unknown) => void;
  let hb: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      send({ type: "hello" });
      onEvt = send;
      bus.on(boardId, onEvt);
      hb = setInterval(() => { try { controller.enqueue(enc.encode(": ping\n\n")); } catch { /* closed */ } }, 25000);
      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        bus.off(boardId, onEvt);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
