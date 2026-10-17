import { aiEnabled } from "@/lib/ai";
import { route } from "@/lib/api";
import { home } from "@/lib/engage";
import { companySites } from "@/lib/suite";

/** Everything the intranet home page shows, with the published sites from Sites. */
export const GET = route(async (me) => {
  const [h, sites, ai] = await Promise.all([home(me), companySites(me), aiEnabled()]);
  return { ...h, sites: sites.sites, sitesAvailable: sites.available, ai };
});
