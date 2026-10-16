import { redirect } from "next/navigation";
import { type Me, PhoneApp } from "@/components/PhoneApp";
import { currentUser, isAdmin } from "@/lib/api";
import { unheardCount } from "@/lib/history";
import { livekitConfig } from "@/lib/livekit";
import { formatNumber } from "@/lib/numbers";
import { numberOf, settingsOf, touch } from "@/lib/people";

export const dynamic = "force-dynamic";

/** ?call=<email or number> fills in the dial box (Chat's call button); ?tab=voicemail opens voicemail. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The gateway signs people in before they get here; this only catches a misconfigured deploy.
  const who = await currentUser();
  if (!who) redirect("/signed-out");
  await touch(who.email, who.name);
  const [mine, settings, unheard] = await Promise.all([numberOf(who.email), settingsOf(who.email), unheardCount(who.email)]);
  const me: Me = {
    email: who.email, name: who.name, admin: isAdmin(who), number: mine?.number ?? null, numberDisplay: formatNumber(mine?.number),
    canCallOut: Boolean(mine?.outboundId), settings, unheardVoicemail: unheard, configured: Boolean(livekitConfig()),
  };
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tab = one(sp.tab);
  return <PhoneApp initialMe={me} initialTo={one(sp.call).slice(0, 200)} initialTab={tab === "voicemail" || tab === "settings" ? tab : "calls"} />;
}
