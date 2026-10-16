import { isAdmin, route } from "@/lib/api";
import { livekitConfig } from "@/lib/livekit";
import { formatNumber } from "@/lib/numbers";
import { numberOf, settingsOf, touch } from "@/lib/people";
import { unheardCount } from "@/lib/history";

export const dynamic = "force-dynamic";

/** Who you are here: your number, your settings, and whether calling is set up at all. */
export const GET = route(async (me) => {
  await touch(me.email, me.name);
  const [mine, settings, unheard] = await Promise.all([numberOf(me.email), settingsOf(me.email), unheardCount(me.email)]);
  return {
    email: me.email, name: me.name, admin: isAdmin(me),
    number: mine?.number ?? null, numberDisplay: formatNumber(mine?.number), canCallOut: Boolean(mine?.outboundId),
    settings, unheardVoicemail: unheard, configured: Boolean(livekitConfig()),
  };
});
