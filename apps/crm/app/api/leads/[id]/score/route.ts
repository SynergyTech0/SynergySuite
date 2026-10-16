import { body, route, type Params } from "@/lib/api";
import * as leads from "@/lib/leads";
import { scoreLead } from "@/lib/scoring";

/** Ask the AI model to score the lead. */
export const POST = route(async (ctx, _req, { params }: Params<"id">) => scoreLead(ctx, (await params).id));

/** Set a manual score ({ score, note }), or clear it with { score: null }. */
export const PUT = route(async (ctx, req, { params }: Params<"id">) => {
  const b = await body(req);
  return leads.overrideScore(ctx, (await params).id, b.score, b.note);
});
