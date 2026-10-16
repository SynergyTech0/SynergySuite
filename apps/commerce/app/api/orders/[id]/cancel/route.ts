import { body, route, type Params } from "@/lib/api";
import { cancelOrder } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => cancelOrder(ctx, (await params).id, (await body<{ reason?: string }>(req)).reason));
