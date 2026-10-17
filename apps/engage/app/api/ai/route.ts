import { aiEnabled, catchUp, summarizePost } from "@/lib/ai";
import { body, route } from "@/lib/api";
import { UserError } from "@/lib/util";

export const GET = route(async () => ({ enabled: await aiEnabled() }));

/** { action: "summarize", postId } or { action: "catchup", community? }. */
export const POST = route(async (me, req) => {
  const b = await body(req);
  if (b.action === "summarize") return { text: await summarizePost(me.email, String(b.postId ?? "")) };
  if (b.action === "catchup") return { text: await catchUp(me.email, typeof b.community === "string" && b.community ? b.community : undefined) };
  throw new UserError("Unknown action");
});
