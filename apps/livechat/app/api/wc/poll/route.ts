import { byToken, visitorPoll } from "@/lib/chat";
import { UserError } from "@/lib/util";
import { checkOrigin, limitIp, preflight, wcRoute } from "@/lib/wc";

export const OPTIONS = preflight;
export const dynamic = "force-dynamic";

/** The widget asks for new messages every few seconds while it is open. */
export const GET = wcRoute(async (req) => {
  limitIp(req, "poll", 120, 60_000);
  const u = new URL(req.url);
  const c = await byToken(u.searchParams.get("token"));
  if (!c) throw new UserError("This chat has ended. Reload the page to start a new one.", 404);
  checkOrigin(req, c.domain);
  return visitorPoll(c.id, u.searchParams.get("after"));
});
