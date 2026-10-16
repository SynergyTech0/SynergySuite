import { body, route, type Params } from "@/lib/api";
import { takePayment } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => takePayment(ctx, (await params).id, await body(req)));
