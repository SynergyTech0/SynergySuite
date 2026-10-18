import { body } from "@/lib/api";
import { start } from "@/lib/chat";
import { UserError } from "@/lib/util";
import { checkOrigin, limitIp, preflight, wcRoute } from "@/lib/wc";
import { widgetByKey } from "@/lib/widgets";

export const OPTIONS = preflight;

/** A visitor opens the chat: answers with their conversation token and the widget's look. */
export const POST = wcRoute(async (req) => {
  limitIp(req, "start", 10, 10 * 60_000);
  const b = await body<{ k?: unknown; name?: unknown; email?: unknown; page?: unknown }>(req);
  const w = await widgetByKey(b.k);
  if (!w) throw new UserError("Unknown chat widget", 404);
  checkOrigin(req, w.domain);
  const { token } = await start(w, b);
  return { token, greeting: w.greeting, color: w.color, name: w.name, askEmail: w.ask_email };
});
