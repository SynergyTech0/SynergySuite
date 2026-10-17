import { sortedLabels } from "@synergy/compliance";
import { route } from "@/lib/api";
import { policy } from "@/lib/policy";

export const dynamic = "force-dynamic";

/** The suite's sensitivity labels for the composer, least sensitive first. */
export const GET = route(async () => {
  const settings = await policy().labels();
  return { labels: sortedLabels(settings), defaultLabelId: settings.defaultLabelId ?? null };
});
