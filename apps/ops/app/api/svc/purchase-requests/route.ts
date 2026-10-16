import { tokenRoute } from "@/lib/api";
import { listPurchaseRequests } from "@/lib/mfg";

/** Open purchase requests for purchasing to order (Bearer OPS_API_TOKEN). */
export const GET = tokenRoute(async () => listPurchaseRequests({ status: "open" }));
