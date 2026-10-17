import { sortedLabels } from "@synergy/compliance";
import { route } from "@/lib/api";
import { policy } from "@/lib/compliance";

/** The organization's sensitivity labels, least sensitive first, and the one new files get. */
export const GET = route(async () => {
  const settings = await policy().labels();
  return { labels: sortedLabels(settings), defaultLabelId: settings.defaultLabelId ?? null };
});
