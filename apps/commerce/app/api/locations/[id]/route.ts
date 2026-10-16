import { body, route, type Params } from "@/lib/api";
import { saveLocation } from "@/lib/catalog";

export const PUT = route(async (ctx, req, { params }: Params<"id">) => saveLocation(ctx, (await params).id, await body(req)));
