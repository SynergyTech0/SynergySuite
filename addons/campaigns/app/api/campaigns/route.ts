import { body, route } from "@/lib/api";
import { createCampaign, listCampaigns } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export const GET = route(async () => listCampaigns());
export const POST = route(async (ctx, req) => createCampaign(ctx, await body(req)));
