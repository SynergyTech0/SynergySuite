import { body, route, type Params } from "@/lib/api";
import { purchaseOrder, updatePo } from "@/lib/purchasing";

export const GET = route(async (_ctx, _req, { params }: Params<"id">) => purchaseOrder((await params).id));
export const PUT = route(async (ctx, req, { params }: Params<"id">) => updatePo(ctx, (await params).id, await body(req)));
