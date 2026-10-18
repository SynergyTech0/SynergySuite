import { body, route } from "@/lib/api";
import { audience, createCampaign, listCampaigns } from "@/lib/sms";

export const GET = route(async (_me, req) => {
  const u = new URL(req.url);
  return u.searchParams.has("audience") ? { count: await audience(u.searchParams.get("audience")) } : listCampaigns();
});
export const POST = route(async (me, req) => createCampaign(me, await body(req)));
