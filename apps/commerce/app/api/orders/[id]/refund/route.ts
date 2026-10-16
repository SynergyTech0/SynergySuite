import { body, route, type Params } from "@/lib/api";
import { refund } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => refund(ctx, (await params).id, await body(req)));
