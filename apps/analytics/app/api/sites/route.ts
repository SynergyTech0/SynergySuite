import { body, route } from "@/lib/api";
import { snippet } from "@/lib/script";
import { createSite, listSites } from "@/lib/sites";

export const GET = route(async (me) => ({ sites: (await listSites(me)).map((s) => ({ ...s, snippet: snippet(s.site_key) })) }));

export const POST = route(async (me, req) => {
  const site = await createSite(me, await body(req));
  return { site: { ...site, snippet: snippet(site.site_key) } };
});
