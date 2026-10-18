import { body } from "@/lib/api";
import { byToken, visitorSays } from "@/lib/chat";
import { allow } from "@/lib/ratelimit";
import { UserError } from "@/lib/util";
import { checkOrigin, limitIp, preflight, wcRoute } from "@/lib/wc";

export const OPTIONS = preflight;

export const POST = wcRoute(async (req) => {
  limitIp(req, "message", 60, 60_000);
  const b = await body<{ token?: unknown; body?: unknown; email?: unknown; name?: unknown }>(req);
  const c = await byToken(b.token);
  if (!c) throw new UserError("This chat has ended. Reload the page to start a new one.", 404);
  checkOrigin(req, c.domain);
  if (!allow(`conv:${c.id}`, 20, 60_000)) throw new UserError("Too many messages. Please wait a moment.", 429);
  const m = await visitorSays(c.id, b);
  return { id: m.id };
});
