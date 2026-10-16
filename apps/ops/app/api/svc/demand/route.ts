import { body, tokenRoute } from "@/lib/api";
import { addDemandBySku } from "@/lib/mfg";

/**
 * Demand from another app (Bearer OPS_API_TOKEN): a sales or store order for a made or stocked
 * item. { sku, qty, dueDate, reference }. MRP plans for it on its next run.
 */
export const POST = tokenRoute(async (req) => addDemandBySku(await body(req), "api"));
