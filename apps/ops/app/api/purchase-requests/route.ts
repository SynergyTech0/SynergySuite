import { body, route } from "@/lib/api";
import { createPurchaseRequest, listPurchaseRequests } from "@/lib/mfg";

export const GET = route(async (_me, req) => listPurchaseRequests({ status: new URL(req.url).searchParams.get("status") || undefined }));
export const POST = route(async (me, req) => {
  await createPurchaseRequest(await body(req), me.email);
  return listPurchaseRequests({ status: "open" });
});
