import { body, route, type Params } from "@/lib/api";
import { closeShift } from "@/lib/sales";

export const POST = route(async (ctx, req, { params }: Params<"id">) => closeShift(ctx, (await params).id, await body(req)));
