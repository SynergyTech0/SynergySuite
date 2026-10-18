import { UserError } from "@/lib/util";
import { checkOrigin, limitIp, preflight, wcRoute } from "@/lib/wc";
import { widgetByKey } from "@/lib/widgets";

export const OPTIONS = preflight;
export const dynamic = "force-dynamic";

/** How the widget looks, read when it loads. */
export const GET = wcRoute(async (req) => {
  limitIp(req, "config", 60, 60_000);
  const w = await widgetByKey(new URL(req.url).searchParams.get("k"));
  if (!w) throw new UserError("Unknown chat widget", 404);
  checkOrigin(req, w.domain);
  return { name: w.name, greeting: w.greeting, color: w.color, askEmail: w.ask_email };
});
