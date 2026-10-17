import { body, route, type Params } from "@/lib/api";
import { deleteCampaign, getCampaign, readiness, updateCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

/** The campaign, and for a draft what still stops it going out and how many it would reach. */
export const GET = route(async (_ctx, _req, { params }: Params<"id">) => {
  const c = await getCampaign((await params).id);
  return { campaign: c, readiness: c.status === "draft" ? await readiness(c) : null };
});
export const PATCH = route(async (ctx, req, { params }: Params<"id">) => updateCampaign(ctx, (await params).id, await body(req)));
export const DELETE = route(async (ctx, _req, { params }: Params<"id">) => deleteCampaign(ctx, (await params).id));
