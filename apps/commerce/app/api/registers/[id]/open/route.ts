import { body, route, type Params } from "@/lib/api";
import { openShift } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => openShift(ctx, (await params).id, await body(req)));
