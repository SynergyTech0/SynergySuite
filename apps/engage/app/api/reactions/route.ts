import { body, route } from "@/lib/api";
import { react } from "@/lib/engage";

/** { targetId, kind }: sets the viewer's reaction on a post or reply; kind null takes it back. */
export const POST = route(async (me, req) => {
  const b = await body(req);
  await react(me, String(b.targetId ?? ""), b.kind);
});
