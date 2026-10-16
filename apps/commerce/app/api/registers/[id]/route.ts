import { body, route, type Params } from "@/lib/api";
import { saveRegister } from "@/lib/sales";

export const PUT = route(async (ctx, req, { params }: Params<"id">) => saveRegister(ctx, (await params).id, await body(req)));
